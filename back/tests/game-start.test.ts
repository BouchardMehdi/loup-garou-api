import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe,expect,it } from 'vitest';
import { roleDeck,shuffledRoles } from '../src/modules/game/service.js';
import { gameFixture,startTime } from './helpers/game.js';
import { origin,settings } from './helpers/lobbies.js';

describe('server role assignment', () => {
  it.each([[6,1,4],[7,1,5],[8,2,5],[9,2,6],[10,2,7],[11,3,7],[12,3,8]])('creates the validated composition at %i players', (count,wolves,villagers) => {
    const roles=shuffledRoles(count);
    expect(roles.filter((r) => r==='WEREWOLF')).toHaveLength(wolves!);
    expect(roles.filter((r) => r==='SEER')).toHaveLength(1);
    expect(roles.filter((r) => r==='VILLAGER')).toHaveLength(villagers!);
  });
  it('uses bounded Fisher-Yates draws and preserves the deck without relying on probabilistic assertions', () => {
    const draws:number[]=[];
    const identity=shuffledRoles(8,(upper) => {draws.push(upper);return upper-1;});
    const shifted=shuffledRoles(8,() => 0);
    expect(draws).toEqual([8,7,6,5,4,3,2]);
    expect(identity).toEqual(roleDeck(8)); expect(shifted).not.toEqual(identity);
    expect([...shifted].sort()).toEqual([...identity].sort());
    expect(() => shuffledRoles(6,() => 99)).toThrow('Invalid random source');
  });
  it.each([0,5,13,6.5])('rejects invalid player count %s', (count) => {
    expect(() => roleDeck(count)).toThrow('PLAYER_COUNT_INVALID');
  });
});

async function prepared(count=6,visibility:'PUBLIC'|'PRIVATE'='PUBLIC') {
  const f=await gameFixture();const owner=await f.client('Owner');
  const created=await owner.post('/api/lobbies',{ ...settings,capacity: 12,visibility,nightDurationSeconds: 90 });
  const lobbyId=created.body.id as string;
  const names=['Guest','Other','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh','Twelfth'];
  for (const name of names.slice(6)) {
    const user={id: randomUUID(),username: name,email:`${name.toLowerCase()}@example.test`,passwordHash:'hash:password',createdAt:new Date()};f.users.set(user.id,user);
  }
  for (const name of names.slice(0,count-1)) {
    const user=[...f.users.values()].find((u) => u.username===name)!;
    await f.service.join(lobbyId,user.id,created.body.invitationCode);
  }
  return {...f,owner,lobbyId};
}

describe('game start resources and confidentiality', () => {
  it('starts once, snapshots participants/durations, creates the first night and returns no secret roles', async () => {
    const f=await prepared();const started=await f.owner.post(`/api/lobbies/${f.lobbyId}/games`);
    expect(started.status).toBe(201);expect(started.headers.location).toBe(`/api/games/${started.body.id}`);
    expect(started.body.status).toBe('IN_PROGRESS');expect(started.body.participants).toHaveLength(6);
    expect(started.body.phase).toMatchObject({type:'NIGHT',cycle:1,startedAt:startTime.toISOString(),deadline:'2026-11-19T12:01:30.000Z'});
    expect(started.text).not.toMatch(/"(role|roleCode|team|invitationHash|email|passwordHash)":/);
    expect(f.data.get(f.lobbyId)!.status).toBe('IN_GAME');
    expect((await f.owner.agent.get(`/api/lobbies/${f.lobbyId}`)).body.gameId).toBe(started.body.id);
    expect((await f.owner.post(`/api/lobbies/${f.lobbyId}/games`)).status).toBe(409);
    expect(f.gameData.size).toBe(1);
    expect((await f.owner.leave(f.lobbyId)).status).toBe(409);
    const late=await f.client('Seventh');expect((await late.post(`/api/lobbies/${f.lobbyId}/memberships`)).status).toBe(409);
    expect((await f.owner.agent.get('/api/lobbies')).body.total).toBe(0);
    expect((await f.owner.agent.get(started.headers.location!)).body).toEqual(started.body);
  });

  it('returns only the caller role, restricts wolf teammates and keeps assignments stable across new sessions', async () => {
    const f=await prepared(8); const started=await f.owner.post(`/api/lobbies/${f.lobbyId}/games`); const gameId=started.body.id;
    const own=await f.owner.agent.get(`/api/games/${gameId}/participants/me`);
    expect(own.body.role).toBe('WEREWOLF');expect(own.body.teammates).toHaveLength(1);expect(own.body.teammates[0].username).toBe('Guest');
    const other=await f.client('Other');const seer=await other.agent.get(`/api/games/${gameId}/participants/me`);
    expect(seer.body.role).toBe('SEER');expect(seer.body.team).toBe('VILLAGE');expect(seer.body.teammates).toEqual([]);
    const villager=await f.client('Fourth');expect((await villager.agent.get(`/api/games/${gameId}/participants/me`)).body).toMatchObject({role:'VILLAGER',teammates:[]});
    const reconnect=await f.client('Owner');expect((await reconnect.agent.get(`/api/games/${gameId}/participants/me`)).body).toEqual(own.body);
    const game=f.gameData.get(gameId)!; game.participants.find((p) => p.userId===own.body.userId)!.status='DEAD';
    expect((await f.owner.agent.get(`/api/games/${gameId}/participants/me`)).body.teammates).toEqual([]);
  });

  it('refuses non-owners, outsiders, too-small groups and client-selected roles without changing the lobby', async () => {
    const f=await prepared(5,'PRIVATE');const member=await f.client('Guest');const outsider=await f.client('Seventh');
    expect((await member.post(`/api/lobbies/${f.lobbyId}/games`)).status).toBe(403);
    expect((await outsider.post(`/api/lobbies/${f.lobbyId}/games`)).status).toBe(404);
    expect((await f.owner.post(`/api/lobbies/${f.lobbyId}/games`)).body.code).toBe('PLAYER_COUNT_INVALID');
    expect((await f.owner.post(`/api/lobbies/${f.lobbyId}/games`,{roles:['WEREWOLF']})).status).toBe(400);
    expect((await f.owner.post('/api/lobbies/not-uuid/games')).status).toBe(400);
    expect(f.data.get(f.lobbyId)!.status).toBe('WAITING');expect(f.gameData.size).toBe(0);
  });

  it('requires auth, CSRF and membership for both public game state and private role access', async () => {
    const f=await prepared();const started=await f.owner.post(`/api/lobbies/${f.lobbyId}/games`);const gameId=started.body.id;
    expect((await request(f.app).get(`/api/games/${gameId}`)).status).toBe(401);
    const outsider=await f.client('Seventh');
    expect((await outsider.agent.get(`/api/games/${gameId}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/games/${gameId}/participants/me`)).status).toBe(404);
    expect((await f.owner.agent.get(`/api/games/${randomUUID()}`)).status).toBe(404);
    expect((await f.owner.agent.get('/api/games/not-uuid/participants/me')).status).toBe(400);
    expect((await f.owner.agent.post(`/api/lobbies/${f.lobbyId}/games`).set('Origin',origin).send({})).status).toBe(403);
    expect((await f.owner.agent.post(`/api/lobbies/${f.lobbyId}/games`).set('Origin','https://evil.example').set('X-CSRF-Token',f.owner.csrf).send({})).status).toBe(403);
    const publicState=await f.owner.agent.get(`/api/games/${gameId}`);expect(publicState.headers['cache-control']).toBe('no-store');
  });
});
