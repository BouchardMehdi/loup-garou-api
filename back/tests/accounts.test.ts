import { randomUUID } from 'node:crypto';
import session from 'express-session';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AccountError, type User, type UserRepository } from '../src/modules/accounts/domain.js';
import { AccountService } from '../src/modules/accounts/service.js';
import { argonPasswords } from '../src/modules/accounts/infrastructure.js';
import type { RequestLimiter } from '../src/http/rate-limit.js';

const origin = 'http://localhost:5173';
const registration = { username: 'Alice', email: 'alice@example.test', password: 'a-long-test-password' };
const fakePasswords = { hash: async (value: string) => `hash:${value}`, verify: async (hash: string, value: string) => hash === `hash:${value}` };

async function fixture(limiter?: RequestLimiter, secureCookies = false) {
  const users = new Map<string, User>();
  const repository: UserRepository = {
    findById: async (id) => users.get(id) ?? null,
    findByEmail: async (email) => [...users.values()].find((user) => user.email === email) ?? null,
    create: async (input) => {
      if ([...users.values()].some((user) => user.email === input.email || user.username.toLowerCase() === input.username.toLowerCase())) {
        throw new AccountError('ACCOUNT_EXISTS');
      }
      const user = { ...input, id: randomUUID(), createdAt: new Date() }; users.set(user.id, user); return user;
    },
  };
  let time = Date.now();
  const app = createApp({ origin, trustProxyHops: secureCookies ? 1 : 0, checks: { database: async () => {}, redis: async () => {} },
    accounts: { service: await AccountService.create(repository, fakePasswords),
      sessionStore: new session.MemoryStore(), limiter: limiter ?? { consume: async () => ({ count: 1, retryAfterMs: 1000 }) },
      secret: 'unit-test-session-secret-at-least-thirty-two-characters', secureCookies,
      sameSite: 'lax', ttlSeconds: 60, origin, now: () => time } });
  const agent = request.agent(app);
  const bootstrap = await agent.get('/api/csrf');
  return { app, agent, users, csrf: bootstrap.body.csrfToken as string,
    advance: () => { time += 61_000; }, cookie: bootstrap.headers['set-cookie'] };
}

describe('account HTTP lifecycle', () => {
  it('registers, rotates the session at login, reads only its own profile, and revokes logout', async () => {
    const { app, agent, csrf, cookie } = await fixture();
    const created = await agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', csrf).send(registration);
    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(`/api/users/${created.body.id}`);
    expect(created.body).not.toHaveProperty('passwordHash');
    expect(created.body).not.toHaveProperty('usernameKey');
    expect(created.headers['cache-control']).toBe('no-store');
    expect((await agent.get('/api/me')).status).toBe(401); // No implicit login.
    const login = await agent.post('/api/sessions').set('Origin', origin).set('X-CSRF-Token', csrf)
      .send({ email: 'ALICE@example.test', password: registration.password });
    expect(login.status).toBe(201);
    expect(login.headers['set-cookie']).not.toEqual(cookie);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('SameSite=Lax');
    expect((await agent.get('/api/me')).body.email).toBe(registration.email);
    expect((await agent.get(created.headers.location!)).status).toBe(200);
    expect((await agent.get('/api/users/someone-else')).status).toBe(404);
    expect((await agent.get('/api/sessions/current')).body).not.toHaveProperty('sessionId');
    const oldCookie = String(cookie?.[0]).split(';')[0]!;
    expect((await request(app).get('/api/me').set('Cookie', oldCookie)).status).toBe(401);
    expect((await agent.delete('/api/sessions/current').set('Origin', origin).set('X-CSRF-Token', csrf)).status).toBe(403);
    const authCookie = String(login.headers['set-cookie']?.[0]).split(';')[0]!;
    const logout = await agent.delete('/api/sessions/current').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken);
    expect(logout.status).toBe(204);
    expect((await request(app).get('/api/me').set('Cookie', authCookie)).status).toBe(401);
  });

  it('rejects malformed input, extra fields and case-insensitive duplicates', async () => {
    const { agent, csrf } = await fixture();
    const register = (body: object) => agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', csrf).send(body);
    expect((await register({ ...registration, password: 'short' })).status).toBe(400);
    expect((await register({ ...registration, username: '<script>' })).status).toBe(400);
    expect((await register({ ...registration, isAdmin: true })).status).toBe(400);
    expect((await register(registration)).status).toBe(201);
    expect((await register({ ...registration, email: 'ALICE@EXAMPLE.TEST', username: 'Other' })).status).toBe(409);
    expect((await register({ ...registration, username: 'aLiCe', email: 'other@example.test' })).status).toBe(409);
  });

  it('does not distinguish a missing account from a bad password', async () => {
    const { agent, csrf } = await fixture();
    await agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', csrf).send(registration);
    const login = (email: string) => agent.post('/api/sessions').set('Origin', origin).set('X-CSRF-Token', csrf)
      .send({ email, password: 'wrong-password' });
    const existing = await login(registration.email); const missing = await login('missing@example.test');
    expect(existing.status).toBe(401); expect(missing.body).toEqual(existing.body);
  });

  it('requires both a valid CSRF token and the configured Origin, including login and registration', async () => {
    const { app, agent, csrf } = await fixture();
    expect((await request(app).post('/api/users').set('Origin', origin).send(registration)).status).toBe(403);
    expect((await agent.post('/api/users').set('X-CSRF-Token', csrf).send(registration)).status).toBe(403);
    expect((await agent.post('/api/sessions').set('Origin', 'https://evil.example').set('X-CSRF-Token', csrf).send({})).status).toBe(403);
    expect((await agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', 'é'.repeat(64)).send(registration)).status).toBe(403);
    expect((await request(app).options('/api/sessions').set('Origin', origin).set('Access-Control-Request-Method', 'POST')).status).toBe(204);
  });

  it('enforces absolute session expiry and allows a fresh bootstrap afterwards', async () => {
    const f = await fixture();
    await f.agent.post('/api/users').set('Origin', origin).set('X-CSRF-Token', f.csrf).send(registration);
    await f.agent.post('/api/sessions').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .send({ email: registration.email, password: registration.password });
    f.advance();
    expect((await f.agent.get('/api/me')).status).toBe(401);
    expect((await f.agent.get('/api/csrf')).status).toBe(200);
    expect((await f.agent.get('/api/me')).status).toBe(401);
  });

  it('sets Secure cookies only over HTTPS when configured for production', async () => {
    const { app } = await fixture(undefined, true);
    expect((await request(app).get('/api/csrf')).headers['set-cookie']).toBeUndefined();
    const https = await request(app).get('/api/csrf').set('X-Forwarded-Proto', 'https');
    expect(String(https.headers['set-cookie'])).toContain('Secure');
    expect(String(https.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('rejects a tampered session cookie', async () => {
    const { app } = await fixture();
    expect((await request(app).get('/api/me').set('Cookie', 'loup.sid=forged-session')).status).toBe(401);
  });

  it('returns 429 with Retry-After before exceeding the auth budget', async () => {
    let exceeded = false;
    const limiter: RequestLimiter = { consume: async (key) => ({ count: key.startsWith('login:') && exceeded ? 11 : 1, retryAfterMs: 5000 }) };
    const { agent, csrf } = await fixture(limiter); exceeded = true;
    const response = await agent.post('/api/sessions').set('Origin', origin).set('X-CSRF-Token', csrf).send({});
    expect(response.status).toBe(429); expect(response.headers['retry-after']).toBe('5');
  });

  it('fails closed when Redis rate limiting is unavailable', async () => {
    const limiter: RequestLimiter = { consume: async () => { throw new Error('redis://private-password'); } };
    const { app } = await fixture(limiter);
    const response = await request(app).get('/api/me');
    expect(response.status).toBe(503); expect(response.text).not.toContain('private-password');
  });
});

it('hashes real passwords with Argon2id and rejects an incorrect password', async () => {
  const hash = await argonPasswords.hash(registration.password);
  expect(hash).toMatch(/^\$argon2id\$/);
  expect(await argonPasswords.verify(hash, registration.password)).toBe(true);
  expect(await argonPasswords.verify(hash, 'wrong-password')).toBe(false);
});
