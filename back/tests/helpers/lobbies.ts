import { randomUUID } from 'node:crypto';
import session from 'express-session';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { AccountService } from '../../src/modules/accounts/service.js';
import type { User, UserRepository } from '../../src/modules/accounts/domain.js';
import { LobbyError, type Lobby, type LobbyRepository } from '../../src/modules/lobbies/domain.js';
import type { GameService } from '../../src/modules/game/service.js';
import { LobbyService } from '../../src/modules/lobbies/service.js';

export const origin = 'http://localhost:5173';
export const settings = { name: 'Village de test', visibility: 'PUBLIC' as const, capacity: 6,
  discussionDurationSeconds: 180, voteDurationSeconds: 60, nightDurationSeconds: 60 };

export function memoryLobbies(users: Map<string, User>) {
  const data = new Map<string, Lobby>();
  let time = Date.now();
  const repo: LobbyRepository = {
    create: async (ownerId, input, invitationHash) => {
      const id = randomUUID(); const now = new Date(time++);
      const owner = { id: ownerId, username: users.get(ownerId)!.username };
      const lobby: Lobby = { ...input, id, gameId: null, status: 'WAITING', owner, invitationHash, createdAt: now,
        members: [{ id: randomUUID(), userId: ownerId, username: owner.username, joinedAt: now }] };
      data.set(id, lobby); return structuredClone(lobby);
    },
    find: async (id) => data.has(id) ? structuredClone(data.get(id)!) : null,
    listPublic: async (page, pageSize) => {
      const lobbies = [...data.values()].filter((l) => l.visibility === 'PUBLIC' && l.status === 'WAITING')
        .sort((a,b) => b.createdAt.getTime()-a.createdAt.getTime() || b.id.localeCompare(a.id));
      return { total: lobbies.length, lobbies: structuredClone(lobbies.slice((page-1)*pageSize, page*pageSize)) };
    },
    withLockedLobby: async (id, work) => {
      const lobby = data.get(id); if (!lobby) throw new LobbyError('LOBBY_NOT_FOUND');
      return work({ lobby: structuredClone(lobby),
        addMember: async (userId) => { lobby.members.push({ id: randomUUID(), userId,
          username: users.get(userId)!.username, joinedAt: new Date(time++) }); },
        leaveMember: async (membershipId) => { lobby.members = lobby.members.filter((m) => m.id !== membershipId); },
        transferOwnership: async (ownerId) => { lobby.owner = { id: ownerId, username: users.get(ownerId)!.username }; },
        close: async () => { lobby.status = 'CLOSED'; },
        reload: async () => structuredClone(lobby),
      });
    },
  };
  return { repo, data };
}

export async function lobbyFixture(createGames?: (memory: ReturnType<typeof memoryLobbies>) => GameService) {
  const users = new Map<string, User>();
  for (const username of ['Owner','Guest','Other','Fourth','Fifth','Sixth','Seventh']) {
    const user = { id: randomUUID(), username, email: `${username.toLowerCase()}@example.test`, passwordHash: 'hash:password', createdAt: new Date() };
    users.set(user.id, user);
  }
  const repository: UserRepository = {
    findById: async (id) => users.get(id) ?? null,
    findByEmail: async (email) => [...users.values()].find((u) => u.email === email) ?? null,
    create: async () => { throw new Error('Not used in lobby tests'); },
  };
  const memory = memoryLobbies(users); const service = new LobbyService(memory.repo);
  const games=createGames?.(memory);
  const app = createApp({ games, origin, trustProxyHops: 0, checks: { database: async () => {}, redis: async () => {} }, lobbies: service,
    accounts: { service: await AccountService.create(repository, { hash: async (p) => `hash:${p}`, verify: async (hash,p) => hash === `hash:${p}` }),
      sessionStore: new session.MemoryStore(), limiter: { consume: async () => ({ count: 1, retryAfterMs: 1000 }) },
      secret: 'lobby-unit-test-session-secret-at-least-32-characters', secureCookies: false, sameSite: 'lax', ttlSeconds: 3600, origin } });
  async function client(username: string) {
    const agent = request.agent(app);
    const token = (await agent.get('/api/csrf')).body.csrfToken;
    const logged = await agent.post('/api/sessions').set('Origin', origin).set('X-CSRF-Token',token)
      .send({ email: `${username.toLowerCase()}@example.test`, password: 'password' });
    const csrf = logged.body.csrfToken as string;
    return { agent, csrf, post: (path: string, body: object = {}) => agent.post(path).set('Origin',origin).set('X-CSRF-Token',csrf).send(body),
      leave: (id: string) => agent.delete(`/api/lobbies/${id}/memberships/me`).set('Origin',origin).set('X-CSRF-Token',csrf) };
  }
  return { app, users, ...memory, service, client, games };
}
