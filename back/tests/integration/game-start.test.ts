import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll,beforeAll,expect,it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { databaseUrl } from '../../src/config/database-url.js';
import { prismaGames } from '../../src/modules/game/infrastructure.js';
import { GameService,roleDeck } from '../../src/modules/game/service.js';
import { prismaLobbies } from '../../src/modules/lobbies/infrastructure.js';
import { LobbyService } from '../../src/modules/lobbies/service.js';
import { prismaUsers,argonPasswords } from '../../src/modules/accounts/infrastructure.js';
import { AccountService } from '../../src/modules/accounts/service.js';
import { redisLimiter } from '../../src/http/rate-limit.js';
import { createApp } from '../../src/app.js';

if (process.env.RUN_INTEGRATION!=='1') throw new Error('Isolated databases and RUN_INTEGRATION=1 required');
const pool=new Pool({ connectionString: databaseUrl(process.env),connectionTimeoutMillis:3000,max:8 });
const prisma=new PrismaClient({ adapter:new PrismaPg(pool) });
const redis=createClient({ url:process.env.REDIS_URL,socket:{connectTimeout:3000,reconnectStrategy:false} });redis.on('error',()=>{});
const gamesRepo=prismaGames(prisma);const games=new GameService(gamesRepo);const lobbies=new LobbyService(prismaLobbies(prisma));
const users:Array<{id:string;email:string}>=[];const lobbyIds:string[]=[];const prefix=`test:game-session:${randomUUID()}:`;const limitPrefix=prefix.replace('session','limit');
beforeAll(async()=>{
  await redis.connect();const passwordHash=await argonPasswords.hash('integration-game-password');const seed=randomUUID().slice(0,8);
  for(let i=0;i<13;i++){
    const user=await prisma.user.create({data:{username:`Game_${seed}_${i}`,usernameKey:`game_${seed}_${i}`,email:`game_${seed}_${i}@example.test`,passwordHash}});
    users.push({id:user.id,email:user.email});
  }
});
afterAll(async()=>{
  try{
    const gameIds=(await prisma.game.findMany({where:{lobbyId:{in:lobbyIds}},select:{id:true}})).map(g=>g.id);
    await prisma.gamePhase.deleteMany({where:{gameId:{in:gameIds}}});
    await prisma.gameParticipant.deleteMany({where:{gameId:{in:gameIds}}});await prisma.game.deleteMany({where:{id:{in:gameIds}}});
    await prisma.lobbyMembership.deleteMany({where:{lobbyId:{in:lobbyIds}}});await prisma.lobby.deleteMany({where:{id:{in:lobbyIds}}});
    await prisma.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
    if(redis.isReady)for(const scopedPrefix of [prefix,limitPrefix])for await(const keys of redis.scanIterator({MATCH:`${scopedPrefix}*`}))if(keys.length)await redis.del(keys);
  }finally{await prisma.$disconnect();await pool.end();if(redis.isOpen)await redis.close();}
});
async function lobby(count=6,visibility:'PUBLIC'|'PRIVATE'='PUBLIC'){
  const result=await lobbies.create(users[0]!.id,{name:'Village game integration',visibility,capacity:12,discussionDurationSeconds:200,voteDurationSeconds:80,nightDurationSeconds:90});
  lobbyIds.push(result.lobby.id);
  for(const user of users.slice(1,count))await lobbies.join(result.lobby.id,user.id,result.invitationCode);
  return result.lobby.id;
}

it('seeds the three server roles with their correct camps',async()=>{
  expect((await prisma.role.findMany({orderBy:{code:'asc'}})).map(r=>[r.code,r.team])).toEqual([['SEER','VILLAGE'],['VILLAGER','VILLAGE'],['WEREWOLF','WEREWOLVES']]);
});
it.each([6,7,8,9,10,11,12])('persists the correct composition and initial night at %i players',async(count)=>{
  const lobbyId=await lobby(count);const game=await games.start(lobbyId,users[0]!.id);
  expect(game.participants.map(p=>p.role).sort()).toEqual(roleDeck(count).sort());
  expect(new Set(game.participants.map(p=>p.userId)).size).toBe(count);expect(game.participants.every(p=>p.status==='ALIVE')).toBe(true);
  expect(game.phases).toHaveLength(1);expect(game.phases[0]!.type).toBe('NIGHT');expect(game.phases[0]!.cycle).toBe(1);
  expect(game.phases[0]!.deadline.getTime()-game.startedAt.getTime()).toBe(90000);
  expect(game).toMatchObject({discussionDurationSeconds:200,voteDurationSeconds:80,nightDurationSeconds:90});
  const reloaded=await new GameService(prismaGames(prisma)).get(game.id,users[0]!.id);
  expect(reloaded.participants).toEqual(game.participants);
  expect((await prisma.lobby.findUniqueOrThrow({where:{id:lobbyId}})).status).toBe('IN_GAME');
  expect((await lobbies.get(lobbyId,users[0]!.id)).gameId).toBe(game.id);
});
it('rejects wrong owners, outsiders and insufficient players with no persistent side effects',async()=>{
  const id=await lobby(5,'PRIVATE');
  await expect(games.start(id,users[1]!.id)).rejects.toMatchObject({code:'START_FORBIDDEN'});
  await expect(games.start(id,users[12]!.id)).rejects.toMatchObject({code:'LOBBY_NOT_FOUND'});
  await expect(games.start(id,users[0]!.id)).rejects.toMatchObject({code:'PLAYER_COUNT_INVALID'});
  expect(await prisma.game.count({where:{lobbyId:id}})).toBe(0);
  expect((await prisma.lobby.findUniqueOrThrow({where:{id}})).status).toBe('WAITING');
});
it('serializes concurrent launches without creating or redistributing a second game',async()=>{
  const id=await lobby();const results=await Promise.allSettled([games.start(id,users[0]!.id),games.start(id,users[0]!.id)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const persisted=await prisma.game.findUniqueOrThrow({where:{lobbyId:id}});
  expect(await prisma.gameParticipant.count({where:{gameId:persisted.id}})).toBe(6);
  expect(await prisma.gamePhase.count({where:{gameId:persisted.id}})).toBe(1);
});
it('serializes a launch against a simultaneous arrival and uses the exact active roster',async()=>{
  const id=await lobby();const results=await Promise.allSettled([games.start(id,users[0]!.id),lobbies.join(id,users[6]!.id)]);
  expect(results[0]!.status).toBe('fulfilled');
  const game=await prisma.game.findUniqueOrThrow({where:{lobbyId:id},include:{participants:true}});
  const members=await prisma.lobbyMembership.findMany({where:{lobbyId:id,leftAt:null}});
  expect(game.participants.map(p=>p.userId).sort()).toEqual(members.map(m=>m.userId).sort());
  expect([6,7]).toContain(game.participants.length);
  if(results[1]!.status==='rejected')expect(results[1]!.reason.code).toBe('LOBBY_NOT_WAITING');
});
it('serializes a launch against a simultaneous departure without starting below six players',async()=>{
  const id=await lobby();const results=await Promise.allSettled([games.start(id,users[0]!.id),lobbies.leave(id,users[1]!.id)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const game=await prisma.game.findUnique({where:{lobbyId:id},include:{participants:true}});
  if(game){expect(game.participants).toHaveLength(6);expect(results[1]!.status).toBe('rejected');}
  else{expect(results[0]!.status).toBe('rejected');expect(await prisma.lobbyMembership.count({where:{lobbyId:id,leftAt:null}})).toBe(5);}
});
it('rolls back the whole game when a database phase constraint rejects the setup',async()=>{
  const id=await lobby();const now=new Date();
  await expect(gamesRepo.start(id,l=>({startedAt:now,deadline:new Date(now.getTime()-1),participants:l.members.map(m=>({...m,role:'VILLAGER'}))}))).rejects.toThrow();
  expect(await prisma.game.count({where:{lobbyId:id}})).toBe(0);
  expect((await prisma.lobby.findUniqueOrThrow({where:{id}})).status).toBe('WAITING');
});
it('protects game/participant uniqueness and a single unresolved phase in PostgreSQL',async()=>{
  const id=await lobby();const game=await games.start(id,users[0]!.id);
  const first=game.participants[0]!;
  await expect(prisma.gameParticipant.create({data:{gameId:game.id,userId:first.userId,usernameSnapshot:first.username,roleCode:first.role}})).rejects.toMatchObject({code:'P2002'});
  await expect(prisma.gamePhase.create({data:{gameId:game.id,type:'DAY_VOTE',cycle:1,startedAt:new Date(),deadline:new Date(Date.now()+60000)}})).rejects.toMatchObject({code:'P2002'});
});
it('exposes only authorized roles over real HTTP sessions and hides a private game from outsiders',async()=>{
  const origin='http://localhost:5173';
  const app=createApp({origin,trustProxyHops:0,checks:{database:async()=>{},redis:async()=>{}},games,lobbies,
    accounts:{service:await AccountService.create(prismaUsers(prisma),argonPasswords),sessionStore:new RedisStore({client:redis,prefix,disableTouch:true}),limiter:redisLimiter(redis,limitPrefix),secret:'game-integration-session-secret-at-least-32-characters',secureCookies:false,sameSite:'lax',ttlSeconds:3600,origin}});
  async function client(user:{id:string;email:string}){
    const agent=request.agent(app);const csrf=(await agent.get('/api/csrf')).body.csrfToken;
    const logged=await agent.post('/api/sessions').set('Origin',origin).set('X-CSRF-Token',csrf).send({email:user.email,password:'integration-game-password'});
    expect(logged.status).toBe(201);return{agent,csrf:logged.body.csrfToken as string};
  }
  const id=await lobby(12,'PRIVATE');const owner=await client(users[0]!);
  const started=await owner.agent.post(`/api/lobbies/${id}/games`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({});
  expect(started.status).toBe(201);expect(started.text).not.toMatch(/"(role|roleCode|team|email|passwordHash)":/);
  const game=await games.get(started.body.id,users[0]!.id);
  for(const role of ['WEREWOLF','SEER','VILLAGER'] as const){
    const player=game.participants.find(p=>p.role===role)!;const session=await client(users.find(u=>u.id===player.userId)!);
    const personal=await session.agent.get(`/api/games/${game.id}/participants/me`);
    expect(personal.body.role).toBe(role);expect(personal.body.userId).toBe(player.userId);
    expect(personal.body.teammates).toHaveLength(role==='WEREWOLF'?2:0);
    expect((await session.agent.get(`/api/games/${game.id}`)).text).not.toMatch(/"(role|roleCode|team)":/);
    expect((await session.agent.get(`/api/games/${game.id}/participants/${users[0]!.id}`)).status).toBe(404);
  }
  const outsider=await client(users[12]!);
  expect((await outsider.agent.get(`/api/games/${game.id}`)).status).toBe(404);
  expect((await outsider.agent.get(`/api/games/${game.id}/participants/me`)).status).toBe(404);
});
