// Run only against an isolated test Compose project, never a live user database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './dist/generated/prisma/client.js';
import { databaseUrl } from './dist/config/database-url.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(process.env) }) });
const base = 'http://127.0.0.1:3000';
const suffix = randomUUID().slice(0, 8);
const data = { username: `Smoke_${suffix}`, email: `${suffix}@example.test`, password: 'smoke-test-password-123' };
let cookie = ''; let userId; const lobbyIds = [];
async function call(path, { method = 'GET', body, csrf } = {}) {
  const headers = { Origin: process.env.APP_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies[0].split(';')[0];
  const result = response.status === 204 ? undefined : await response.json();
  return { response, result };
}
try {
  const bootstrap = await call('/api/csrf'); assert.equal(bootstrap.response.status, 200);
  const csrf = bootstrap.result.csrfToken; const anonymousCookie = cookie;
  const created = await call('/api/users', { method: 'POST', csrf, body: data });
  assert.equal(created.response.status, 201); userId = created.result.id;
  assert.equal('passwordHash' in created.result, false);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.match(stored.passwordHash, /^\$argon2id\$/);
  const duplicate = await call('/api/users', { method: 'POST', csrf, body: { ...data, email: data.email.toUpperCase() } });
  assert.equal(duplicate.response.status, 409);
  const login = await call('/api/sessions', { method: 'POST', csrf, body: { email: data.email, password: data.password } });
  assert.equal(login.response.status, 201); assert.notEqual(cookie, anonymousCookie);
  const authenticatedCookie = cookie;
  assert.equal((await call('/api/me')).result.email, data.email);
  const publicLobby = await call('/api/lobbies', { method: 'POST', csrf: login.result.csrfToken, body: { name: 'Smoke public lobby', capacity: 6 } });
  assert.equal(publicLobby.response.status, 201); lobbyIds.push(publicLobby.result.id);
  assert.equal(publicLobby.result.memberCount, 1);
  const privateLobby = await call('/api/lobbies', { method: 'POST', csrf: login.result.csrfToken, body: { name: 'Smoke private lobby', visibility: 'PRIVATE' } });
  assert.equal(privateLobby.response.status, 201); lobbyIds.push(privateLobby.result.id);
  assert.match(privateLobby.result.invitationCode, /^[A-F0-9]{24}$/);
  const list = await call('/api/lobbies?page=1&pageSize=100');
  assert.equal(list.response.status, 200);
  assert.equal(list.result._embedded.lobbies.some(l => l.id === publicLobby.result.id), true);
  assert.equal(list.result._embedded.lobbies.some(l => l.id === privateLobby.result.id), false);
  assert.equal('invitationCode' in (await call(`/api/lobbies/${privateLobby.result.id}`)).result, false);
  for (const id of lobbyIds) {
    assert.equal((await call(`/api/lobbies/${id}/memberships/me`, { method: 'DELETE', csrf: login.result.csrfToken })).response.status, 204);
  }
  assert.equal((await call('/api/sessions/current', { method: 'DELETE', csrf })).response.status, 403);
  assert.equal((await call('/api/sessions/current', { method: 'DELETE', csrf: login.result.csrfToken })).response.status, 204);
  cookie = authenticatedCookie;
  assert.equal((await call('/api/me')).response.status, 401);
  console.log('Accounts and lobbies smoke test passed: PostgreSQL, Redis sessions, CSRF, public/private lobbies, leave and logout.');
} finally {
  await prisma.lobbyMembership.deleteMany({ where: { lobbyId: { in: lobbyIds } } });
  await prisma.lobby.deleteMany({ where: { id: { in: lobbyIds } } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
}
