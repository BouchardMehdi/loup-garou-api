import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PrismaPg} from '@prisma/adapter-pg';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {PrismaClient} from '../../src/generated/prisma/client.js';
import {databaseUrl} from '../../src/config/database-url.js';
import {prismaGames} from '../../src/modules/game/infrastructure.js';
import {GameService,publicGame} from '../../src/modules/game/service.js';
import {GameEngine} from '../../src/modules/game/engine.js';
import {prismaEngine} from '../../src/modules/game/engine-repository.js';
import {prismaLobbies} from '../../src/modules/lobbies/infrastructure.js';
import {LobbyService} from '../../src/modules/lobbies/service.js';
import type {Game} from '../../src/modules/game/domain.js';

if(process.env.RUN_INTEGRATION!=='1')throw new Error('Isolated database and RUN_INTEGRATION=1 required');
const pool=new Pool({connectionString:databaseUrl(process.env),connectionTimeoutMillis:3000,max:8});
const prisma=new PrismaClient({adapter:new PrismaPg(pool)});
let time=new Date('2030-01-01T00:00:00Z');const now=()=>new Date(time);
// Future clock keeps the real API scheduler from processing these isolated fixtures.
const games=new GameService(prismaGames(prisma),now,n=>n-1);const repository=prismaEngine(prisma);const engine=new GameEngine(repository,now);
const lobbies=new LobbyService(prismaLobbies(prisma));const users:string[]=[];const lobbyIds:string[]=[];
beforeAll(async()=>{
  const seed=randomUUID().slice(0,8);
  for(let i=0;i<9;i++)users.push((await prisma.user.create({data:{username:`Engine_${seed}_${i}`,usernameKey:`engine_${seed}_${i}`,email:`engine_${seed}_${i}@example.test`,passwordHash:'unused-engine-test-hash'}})).id);
});
afterAll(async()=>{
  try{
    const ids=(await prisma.game.findMany({where:{lobbyId:{in:lobbyIds}},select:{id:true}})).map(g=>g.id);
    await prisma.nightAction.deleteMany({where:{gameId:{in:ids}}});await prisma.villageVote.deleteMany({where:{gameId:{in:ids}}});
    await prisma.gamePhase.deleteMany({where:{gameId:{in:ids}}});await prisma.gameParticipant.deleteMany({where:{gameId:{in:ids}}});await prisma.game.deleteMany({where:{id:{in:ids}}});
    await prisma.lobbyMembership.deleteMany({where:{lobbyId:{in:lobbyIds}}});await prisma.lobby.deleteMany({where:{id:{in:lobbyIds}}});await prisma.user.deleteMany({where:{id:{in:users}}});
  }finally{await prisma.$disconnect();await pool.end();}
});
async function fixture(count=6){
  time=new Date('2030-01-01T00:00:00Z');
  const {lobby}=await lobbies.create(users[0]!,{name:'Engine integration',visibility:'PUBLIC',capacity:12,discussionDurationSeconds:30,voteDurationSeconds:30,nightDurationSeconds:30});lobbyIds.push(lobby.id);
  for(const id of users.slice(1,count))await lobbies.join(lobby.id,id);
  const game=await games.start(lobby.id,users[0]!);return game;
}
const current=(game:Game)=>game.phases.find(p=>p.resolvedAt===null)!;
const actor=(game:Game,role:string)=>game.participants.find(p=>p.role===role&&p.status==='ALIVE')!;
const reload=(game:Game)=>games.get(game.id,users[0]!);
async function passNight(game:Game){for(const p of game.participants.filter(p=>p.status==='ALIVE'&&p.role!=='VILLAGER'))await engine.submit(game.id,current(game).id,p.userId,null,'night');return reload(game);}
async function endDiscussion(game:Game){time=current(game).deadline;await engine.advance(game.id);return reload(game);}

it('persists concurrent night actions, private inspection and exactly one victim/next phase',async()=>{
  let game=await fixture();const phase=current(game);const wolf=actor(game,'WEREWOLF');const seer=actor(game,'SEER');
  const choices=await Promise.all([engine.submit(game.id,phase.id,wolf.userId,seer.userId,'night'),engine.submit(game.id,phase.id,seer.userId,wolf.userId,'night')]);
  expect(choices[1]!.inspectionRole).toBe('WEREWOLF');game=await reload(game);
  expect(current(game).type).toBe('DAY_DISCUSSION');expect(game.participants.find(p=>p.id===seer.id)!.status).toBe('DEAD');
  expect(game.phases).toHaveLength(2);expect(game.choices).toHaveLength(2);
  const recovered=new GameService(prismaGames(prisma));expect((await recovered.personal(game.id,seer.userId)).inspections[0]!.role).toBe('WEREWOLF');
  expect((await recovered.personal(game.id,wolf.userId)).inspections).toEqual([]);
  expect(JSON.stringify(publicGame(game))).not.toMatch(/"(role|team|inspectionRole|targetUserId)":/);
  await expect(engine.submit(game.id,phase.id,users[8]!,null,'night')).rejects.toMatchObject({code:'GAME_NOT_FOUND'});
});
it('serializes duplicate requests and competing deadline workers in PostgreSQL',async()=>{
  let game=await fixture();const phase=current(game);const wolf=actor(game,'WEREWOLF');const victim=actor(game,'VILLAGER');
  const results=await Promise.allSettled([engine.submit(game.id,phase.id,wolf.userId,victim.userId,'night'),engine.submit(game.id,phase.id,wolf.userId,victim.userId,'night')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await prisma.nightAction.count({where:{gameId:game.id}})).toBe(1);
  time=phase.deadline;const resolutions=await Promise.all([engine.advance(game.id),new GameEngine(prismaEngine(prisma),now).advance(game.id)]);
  expect(resolutions.filter(Boolean)).toHaveLength(1);game=await reload(game);
  expect(game.phases).toHaveLength(2);expect(game.participants.filter(p=>p.status==='DEAD')).toHaveLength(1);
  expect(current(game).deadline.getTime()-time.getTime()).toBe(30000);
});
it('commits expiry despite refusing an exact-deadline submission and recovers persisted deadlines after restart',async()=>{
  let game=await fixture();const phase=current(game);time=phase.deadline;
  await expect(engine.submit(game.id,phase.id,actor(game,'WEREWOLF').userId,null,'night')).rejects.toMatchObject({code:'PHASE_CLOSED'});
  game=await reload(game);expect(current(game).type).toBe('DAY_DISCUSSION');expect(game.choices).toHaveLength(0);
  time=new Date(time.getTime()+86400000);await new GameEngine(prismaEngine(prisma),now).tick();game=await reload(game);
  expect(current(game).type).toBe('DAY_VOTE');expect(current(game).startedAt).toEqual(time);expect(current(game).deadline.getTime()-time.getTime()).toBe(30000);
});
it('resolves tied wolves and tied village votes without a victim and advances the cycle',async()=>{
  let game=await fixture(8);const phase=current(game);const wolves=game.participants.filter(p=>p.role==='WEREWOLF');const villagers=game.participants.filter(p=>p.role==='VILLAGER');
  await engine.submit(game.id,phase.id,wolves[0]!.userId,villagers[0]!.userId,'night');await engine.submit(game.id,phase.id,wolves[1]!.userId,villagers[1]!.userId,'night');await engine.submit(game.id,phase.id,actor(game,'SEER').userId,null,'night');
  game=await endDiscussion(await reload(game));const vote=current(game).id;const a=game.participants[0]!;const b=game.participants[1]!;
  for(const p of game.participants)await engine.submit(game.id,vote,p.userId,p.id===a.id?b.userId:p.id===b.id?a.userId:null,'vote');
  game=await reload(game);expect(current(game)).toMatchObject({type:'NIGHT',cycle:2});expect(game.participants.every(p=>p.status==='ALIVE')).toBe(true);
});
it('rejects invalid roles, self, teammates, dead and foreign targets without persisting them',async()=>{
  const game=await fixture(8);const phase=current(game).id;const wolves=game.participants.filter(p=>p.role==='WEREWOLF');const villager=actor(game,'VILLAGER');
  await expect(engine.submit(game.id,phase,villager.userId,null,'night')).rejects.toMatchObject({code:'ROLE_FORBIDDEN'});
  await expect(engine.submit(game.id,phase,wolves[0]!.userId,wolves[0]!.userId,'night')).rejects.toMatchObject({code:'TARGET_FORBIDDEN'});
  await expect(engine.submit(game.id,phase,wolves[0]!.userId,wolves[1]!.userId,'night')).rejects.toMatchObject({code:'TARGET_FORBIDDEN'});
  await expect(engine.submit(game.id,phase,wolves[0]!.userId,users[8]!,'night')).rejects.toMatchObject({code:'TARGET_NOT_FOUND'});
  await expect(engine.submit(game.id,phase,wolves[0]!.userId,null,'vote')).rejects.toMatchObject({code:'WRONG_PHASE'});
  await prisma.gameParticipant.update({where:{id:villager.id},data:{status:'DEAD',eliminatedAt:time}});
  await expect(engine.submit(game.id,phase,villager.userId,null,'night')).rejects.toMatchObject({code:'PLAYER_DEAD'});
  await expect(engine.submit(game.id,phase,wolves[0]!.userId,villager.userId,'night')).rejects.toMatchObject({code:'TARGET_FORBIDDEN'});
  expect(await prisma.nightAction.count({where:{gameId:game.id}})).toBe(0);
});
it('enforces same-game foreign keys and final-choice uniqueness even outside the service',async()=>{
  const game=await fixture();const other=await fixture();const wolf=actor(game,'WEREWOLF');const phase=current(game).id;
  const data={gameId:game.id,phaseId:phase,actorId:wolf.id,kind:'WOLF_ATTACK' as const,createdAt:time};
  await expect(prisma.nightAction.create({data:{...data,targetId:other.participants[1]!.id}})).rejects.toMatchObject({code:'P2003'});
  await expect(prisma.nightAction.create({data:{...data,phaseId:current(other).id}})).rejects.toMatchObject({code:'P2003'});
  await expect(prisma.villageVote.create({data:{gameId:game.id,phaseId:phase,actorId:other.participants[0]!.id,createdAt:time}})).rejects.toMatchObject({code:'P2003'});
  await engine.submit(game.id,phase,wolf.userId,null,'night');await expect(prisma.nightAction.create({data})).rejects.toMatchObject({code:'P2002'});
});
it('finishes a real persisted game for the village, reveals final roles and closes all phases',async()=>{
  let game=await fixture();const wolf=actor(game,'WEREWOLF');game=await endDiscussion(await passNight(game));const vote=current(game).id;
  await Promise.all(game.participants.map(p=>engine.submit(game.id,vote,p.userId,p.id===wolf.id?null:wolf.userId,'vote')));
  game=await reload(game);expect(game).toMatchObject({status:'FINISHED',winner:'VILLAGE',finishedAt:time});expect(game.phases.filter(p=>p.resolvedAt===null)).toHaveLength(0);
  expect((await prisma.lobby.findUniqueOrThrow({where:{id:game.lobbyId}})).status).toBe('FINISHED');expect(publicGame(game).participants.every(p=>'role'in p)).toBe(true);
  await expect(engine.submit(game.id,vote,wolf.userId,null,'vote')).rejects.toMatchObject({code:'GAME_FINISHED'});expect(await engine.advance(game.id)).toBe(false);
});
it('detects wolf victory at parity over multiple persisted cycles',async()=>{
  let game=await fixture();const wolf=actor(game,'WEREWOLF');const seer=actor(game,'SEER');
  await engine.submit(game.id,current(game).id,seer.userId,null,'night');await engine.submit(game.id,current(game).id,wolf.userId,seer.userId,'night');game=await reload(game);
  for(let i=0;i<2;i++){
    game=await endDiscussion(game);const vote=current(game).id;const victim=actor(game,'VILLAGER');
    for(const p of game.participants.filter(p=>p.status==='ALIVE'))await engine.submit(game.id,vote,p.userId,p.id===victim.id?null:victim.userId,'vote');
    game=await reload(game);if(game.status==='FINISHED')break;
    await engine.submit(game.id,current(game).id,wolf.userId,actor(game,'VILLAGER').userId,'night');game=await reload(game);
  }
  expect(game.status).toBe('FINISHED');expect(game.winner).toBe('WEREWOLVES');expect(game.participants.filter(p=>p.status==='ALIVE')).toHaveLength(2);
});
