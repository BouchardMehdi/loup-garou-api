// Isolated test Compose project only. Synthetic accounts are seeded to respect registration rate limits.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from './dist/generated/prisma/client.js';
import {databaseUrl} from './dist/config/database-url.js';
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl(process.env)})});
const users=[];let lobbyId;const clients=[];const base='http://127.0.0.1:3000';
function client(){
  let cookie='';let token;
  return{async call(path,{method='GET',body}={}){
    const headers={Origin:process.env.APP_ORIGIN,...(cookie?{Cookie:cookie}:{}),...(token?{'X-CSRF-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})};
    const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
    const cookies=response.headers.getSetCookie();if(cookies.length)cookie=cookies[0].split(';')[0];
    const data=response.status===204?undefined:await response.json();if(data?.csrfToken)token=data.csrfToken;
    return{status:response.status,data};
  }};
}
try{
  const seed=randomUUID().slice(0,8);const password='smoke-game-password';const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  for(let i=0;i<6;i++){
    const user=await prisma.user.create({data:{username:`Start_${seed}_${i}`,usernameKey:`start_${seed}_${i}`,email:`start_${seed}_${i}@example.test`,passwordHash}});users.push(user.id);
    const c=client();assert.equal((await c.call('/api/csrf')).status,200);
    assert.equal((await c.call('/api/sessions',{method:'POST',body:{email:user.email,password}})).status,201);clients.push(c);
  }
  const created=await clients[0].call('/api/lobbies',{method:'POST',body:{name:'Smoke game start',capacity:6}});assert.equal(created.status,201);lobbyId=created.data.id;
  for(const c of clients.slice(1))assert.equal((await c.call(`/api/lobbies/${lobbyId}/memberships`,{method:'POST',body:{}})).status,201);
  const started=await clients[0].call(`/api/lobbies/${lobbyId}/games`,{method:'POST',body:{}});assert.equal(started.status,201);
  assert.equal(started.data.participants.length,6);assert.equal(started.data.phase.type,'NIGHT');
  assert.equal(started.data.participants.some(p=>'role'in p || 'roleCode'in p || 'team'in p),false);
  const roles=[];
  for(const c of clients){const personal=await c.call(`/api/games/${started.data.id}/participants/me`);assert.equal(personal.status,200);roles.push(personal.data.role);}
  assert.deepEqual(roles.sort(),['SEER','VILLAGER','VILLAGER','VILLAGER','VILLAGER','WEREWOLF']);
  assert.equal((await clients[0].call(`/api/lobbies/${lobbyId}/games`,{method:'POST',body:{}})).status,409);
  assert.equal((await clients[0].call(`/api/lobbies/${lobbyId}`)).data.gameId,started.data.id);
  assert.equal((await clients[1].call(`/api/lobbies/${lobbyId}/memberships/me`,{method:'DELETE'})).status,409);
  assert.equal(await prisma.game.count({where:{lobbyId}}),1);
  for(const c of clients)assert.equal((await c.call('/api/sessions/current',{method:'DELETE'})).status,204);
  console.log('Game-start smoke test passed: six authenticated players, frozen lobby, secret roles and unique launch.');
}finally{
  if(lobbyId){const game=await prisma.game.findUnique({where:{lobbyId}});if(game){await prisma.gamePhase.deleteMany({where:{gameId:game.id}});await prisma.gameParticipant.deleteMany({where:{gameId:game.id}});await prisma.game.delete({where:{id:game.id}});}
    await prisma.lobbyMembership.deleteMany({where:{lobbyId}});await prisma.lobby.delete({where:{id:lobbyId}});}
  await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
}
