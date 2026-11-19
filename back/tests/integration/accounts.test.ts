import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { databaseUrl } from '../../src/config/database-url.js';
import { prismaUsers, argonPasswords } from '../../src/modules/accounts/infrastructure.js';
import { AccountService } from '../../src/modules/accounts/service.js';
import { redisLimiter } from '../../src/http/rate-limit.js';
import { createApp } from '../../src/app.js';

if (process.env.RUN_INTEGRATION !== '1') throw new Error('RUN_INTEGRATION=1 and isolated PostgreSQL/Redis are required');
const pool = new Pool({ connectionString: databaseUrl(process.env), connectionTimeoutMillis: 3000 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: false } });
redis.on('error', () => {});
const ids: string[] = [];
const prefix = `test:session:${randomUUID()}:`;
beforeAll(async () => { await redis.connect(); });
afterAll(async () => {
  try {
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (redis.isReady) {
      for await (const keys of redis.scanIterator({ MATCH: `${prefix}*` })) { if (keys.length) await redis.del(keys); }
    }
  } finally {
    await prisma.$disconnect(); await pool.end();
    if (redis.isOpen) await redis.close();
  }
});

it('persists users, normalized uniqueness, sessions and revocation in PostgreSQL/Redis', async () => {
  const service = await AccountService.create(prismaUsers(prisma), argonPasswords);
  const origin = 'http://localhost:5173';
  const app = createApp({ origin, trustProxyHops: 0, checks: { database: async () => {}, redis: async () => {} }, accounts: {
    service, sessionStore: new RedisStore({ client: redis, prefix, disableTouch: true }),
    limiter: redisLimiter(redis), secret: 'integration-only-session-secret-at-least-32-characters',
    secureCookies: false, sameSite: 'lax', ttlSeconds: 3600, origin,
  } });
  const agent = request.agent(app);
  const token = (await agent.get('/api/csrf')).body.csrfToken;
  const suffix = randomUUID().slice(0, 8); const email = `${suffix}@example.test`;
  const body = { username: `User_${suffix}`, email, password: 'integration-test-password' };
  const created = await agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', token).send(body);
  expect(created.status).toBe(201); ids.push(created.body.id);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } });
  expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  expect(stored.passwordHash).not.toBe(body.password);
  const duplicate = await agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', token)
    .send({ ...body, email: email.toUpperCase(), username: `Other_${suffix}` });
  expect(duplicate.status).toBe(409);
  const nameDuplicate = await agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', token)
    .send({ ...body, username: body.username.toLowerCase(), email: `other-${email}` });
  expect(nameDuplicate.status).toBe(409);
  const login = await agent.post('/api/sessions').set('Origin', origin).set('X-CSRF-Token', token)
    .send({ email, password: body.password });
  expect(login.status).toBe(201);
  const keys = await redis.keys(`${prefix}*`);
  expect(keys).toHaveLength(1);
  expect(await redis.ttl(keys[0]!)).toBeGreaterThan(0);
  expect((await agent.get('/api/me')).body.email).toBe(email);
  const stolenCookie = String(login.headers['set-cookie']?.[0]).split(';')[0]!;
  expect((await agent.delete('/api/sessions/current').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken)).status).toBe(204);
  expect(await redis.keys(`${prefix}*`)).toHaveLength(0);
  expect((await request(app).get('/api/me').set('Cookie', stolenCookie)).status).toBe(401);
});

it('uses an atomic shared Redis rate counter with an expiry', async () => {
  const limiter = redisLimiter(redis); const key = `integration:${randomUUID()}`;
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.consume(key, 10000)));
    expect(results.map((result) => result.count).sort((a,b) => a-b)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(results.every((result) => result.retryAfterMs > 0)).toBe(true);
  } finally { await redis.del(`loup:limit:${key}`); }
});
