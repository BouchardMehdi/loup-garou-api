import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { databaseUrl } from '../../src/config/database-url.js';
import { LobbyService } from '../../src/modules/lobbies/service.js';
import { prismaLobbies } from '../../src/modules/lobbies/infrastructure.js';
import { AccountService } from '../../src/modules/accounts/service.js';
import { prismaUsers, argonPasswords } from '../../src/modules/accounts/infrastructure.js';
import { redisLimiter } from '../../src/http/rate-limit.js';
import { createApp } from '../../src/app.js';

if (process.env.RUN_INTEGRATION !== '1') throw new Error('Isolated databases and RUN_INTEGRATION=1 required');
const pool = new Pool({ connectionString: databaseUrl(process.env), connectionTimeoutMillis: 3000, max: 8 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: false } });
redis.on('error', () => {});
const repo = prismaLobbies(prisma); const service = new LobbyService(repo);
const users: Array<{ id: string; email: string }> = []; const lobbyIds: string[] = [];
const prefix = `test:lobby-session:${randomUUID()}:`;
const limitPrefix = prefix.replace('session', 'limit');
const settings = { name: 'Village integration', visibility: 'PUBLIC' as const, capacity: 6,
  discussionDurationSeconds: 180, voteDurationSeconds: 60, nightDurationSeconds: 60 };

beforeAll(async () => {
  await redis.connect(); const passwordHash = await argonPasswords.hash('integration-password');
  const seed = randomUUID().slice(0,8);
  for (let i=0;i<8;i++) {
    const user = await prisma.user.create({ data: { username: `Lobby_${seed}_${i}`, usernameKey: `lobby_${seed}_${i}`,
      email: `${seed}_${i}@example.test`, passwordHash } });
    users.push({ id: user.id, email: user.email });
  }
});
afterAll(async () => {
  try {
    await prisma.lobbyMembership.deleteMany({ where: { lobbyId: { in: lobbyIds } } });
    await prisma.lobby.deleteMany({ where: { id: { in: lobbyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    if (redis.isReady) for (const scopedPrefix of [prefix,limitPrefix]) for await (const keys of redis.scanIterator({ MATCH: `${scopedPrefix}*` })) { if (keys.length) await redis.del(keys); }
  } finally {
    await prisma.$disconnect(); await pool.end(); if (redis.isOpen) await redis.close();
  }
});
async function create(visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const result = await service.create(users[0]!.id, { ...settings, visibility }); lobbyIds.push(result.lobby.id); return result;
}

it('hides private lobbies and stores only invitation hashes, while accepting the valid code', async () => {
  const { lobby, invitationCode } = await create('PRIVATE');
  expect((await prisma.lobby.findUniqueOrThrow({ where: { id: lobby.id } })).invitationHash).not.toBe(invitationCode);
  expect((await service.list(1,100)).lobbies.some((l) => l.id === lobby.id)).toBe(false);
  await expect(service.get(lobby.id, users[1]!.id)).rejects.toMatchObject({ code: 'LOBBY_NOT_FOUND' });
  await expect(service.join(lobby.id, users[1]!.id, '0'.repeat(24))).rejects.toMatchObject({ code: 'LOBBY_NOT_FOUND' });
  expect((await service.join(lobby.id, users[1]!.id, invitationCode!.toLowerCase())).members).toHaveLength(2);
});

it('serializes concurrent joins for the last seat without overbooking', async () => {
  const { lobby } = await create();
  for (let i=1;i<=4;i++) await service.join(lobby.id, users[i]!.id);
  const results = await Promise.allSettled([service.join(lobby.id,users[5]!.id),service.join(lobby.id,users[6]!.id)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('LOBBY_FULL');
  expect(await prisma.lobbyMembership.count({ where: { lobbyId: lobby.id, leftAt: null } })).toBe(6);
});

it('rejects duplicate concurrent joins and preserves departed memberships on rejoin', async () => {
  const { lobby } = await create();
  const results = await Promise.allSettled([service.join(lobby.id,users[1]!.id),service.join(lobby.id,users[1]!.id)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('ALREADY_MEMBER');
  await expect(prisma.lobbyMembership.create({ data: { lobbyId: lobby.id, userId: users[1]!.id } })).rejects.toMatchObject({ code: 'P2002' });
  await service.leave(lobby.id,users[1]!.id); await service.join(lobby.id,users[1]!.id);
  const history = await prisma.lobbyMembership.findMany({ where: { lobbyId: lobby.id, userId: users[1]!.id } });
  expect(history).toHaveLength(2); expect(history.filter((m) => m.leftAt === null)).toHaveLength(1);
});

it('transfers ownership to the earliest remaining member, then closes the empty lobby atomically', async () => {
  const { lobby } = await create();
  await service.join(lobby.id,users[1]!.id); await service.join(lobby.id,users[2]!.id);
  await service.leave(lobby.id,users[0]!.id);
  const after = await service.get(lobby.id,users[1]!.id); expect(after.owner.id).toBe(users[1]!.id);
  await service.leave(lobby.id,users[1]!.id); await service.leave(lobby.id,users[2]!.id);
  const closed = await prisma.lobby.findUniqueOrThrow({ where: { id: lobby.id } });
  expect(closed.status).toBe('CLOSED');
  expect(await prisma.lobbyMembership.count({ where: { lobbyId: lobby.id,leftAt: null } })).toBe(0);
  await expect(service.join(lobby.id,users[3]!.id)).rejects.toMatchObject({ code: 'LOBBY_NOT_WAITING' });
});

it('keeps ownership and status coherent when the last member leaves while a guest joins', async () => {
  const { lobby } = await create();
  await Promise.allSettled([service.leave(lobby.id,users[0]!.id),service.join(lobby.id,users[1]!.id)]);
  const saved = await repo.find(lobby.id); expect(saved).not.toBeNull();
  if (saved!.members.length===0) expect(saved!.status).toBe('CLOSED');
  else { expect(saved!.members).toHaveLength(1); expect(saved!.status).toBe('WAITING'); expect(saved!.owner.id).toBe(saved!.members[0]!.userId); }
});

it('forbids membership changes once a future game has started', async () => {
  const { lobby } = await create(); await prisma.lobby.update({ where: { id: lobby.id }, data: { status: 'IN_GAME' } });
  await expect(service.leave(lobby.id,users[0]!.id)).rejects.toMatchObject({ code: 'LOBBY_NOT_WAITING' });
  await expect(service.join(lobby.id,users[1]!.id)).rejects.toMatchObject({ code: 'LOBBY_NOT_WAITING' });
  expect(await prisma.lobbyMembership.count({ where: { lobbyId: lobby.id, leftAt: null } })).toBe(1);
});

it('exercises private creation/join/leave through real authenticated HTTP sessions and CSRF', async () => {
  const origin = 'http://localhost:5173';
  const app = createApp({ origin, trustProxyHops: 0, checks: { database: async () => {}, redis: async () => {} }, lobbies: service,
    accounts: { service: await AccountService.create(prismaUsers(prisma),argonPasswords),
      sessionStore: new RedisStore({ client: redis,prefix,disableTouch: true }),limiter: redisLimiter(redis,limitPrefix),
      secret: 'lobby-integration-test-session-secret-at-least-32-characters',secureCookies: false,sameSite: 'lax',ttlSeconds: 3600,origin } });
  const clients=[];
  for (const user of users.slice(0,2)) {
    const agent=request.agent(app); const token=(await agent.get('/api/csrf')).body.csrfToken;
    const login=await agent.post('/api/sessions').set('Origin',origin).set('X-CSRF-Token',token).send({ email: user.email,password: 'integration-password' });
    expect(login.status).toBe(201); clients.push({agent,csrf: login.body.csrfToken as string});
  }
  const owner=clients[0]!; const guest=clients[1]!;
  const created=await owner.agent.post('/api/lobbies').set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({...settings,visibility:'PRIVATE'});
  expect(created.status).toBe(201); lobbyIds.push(created.body.id);
  const url=`/api/lobbies/${created.body.id}`;
  expect((await guest.agent.get(url)).status).toBe(404);
  const joined=await guest.agent.post(`${url}/memberships`).set('Origin',origin).set('X-CSRF-Token',guest.csrf).send({invitationCode: created.body.invitationCode});
  expect(joined.status).toBe(201);
  const detail=await guest.agent.get(url); expect(detail.body.memberCount).toBe(2);
  expect(detail.text).not.toContain('invitationHash'); expect(detail.text).not.toContain('email');
  expect((await guest.agent.delete(`${url}/memberships/me`).set('Origin',origin).set('X-CSRF-Token',guest.csrf)).status).toBe(204);
  expect((await guest.agent.get(url)).status).toBe(404);
});
