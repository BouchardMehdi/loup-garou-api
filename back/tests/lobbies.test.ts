import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { lobbyFixture, origin, settings } from './helpers/lobbies.js';

const path = (id: string) => `/api/lobbies/${id}`;
describe('authenticated lobby resources', () => {
  it('creates a public lobby with its owner as member, lists HAL pages and exposes no personal secrets', async () => {
    const f = await lobbyFixture(); const owner = await f.client('Owner');
    const created = await owner.post('/api/lobbies', settings);
    expect(created.status).toBe(201); expect(created.headers.location).toBe(path(created.body.id));
    expect(created.body.memberCount).toBe(1); expect(created.body.members[0].username).toBe('Owner');
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body).not.toHaveProperty('invitationCode');
    await owner.post('/api/lobbies', { name: 'Second village' });
    const list = await owner.agent.get('/api/lobbies?page=1&pageSize=1');
    expect(list.status).toBe(200); expect(list.headers['content-type']).toContain('application/hal+json');
    expect(list.body.total).toBe(2); expect(list.body._embedded.lobbies).toHaveLength(1);
    expect(list.body._links.next.href).toBe('/api/lobbies?page=2&pageSize=1');
    const second = await owner.agent.get(list.body._links.next.href);
    expect(second.body._links.prev.href).toBe('/api/lobbies?page=1&pageSize=1');
    expect(second.body._embedded.lobbies[0].id).toBe(created.body.id);
    expect((await owner.agent.get('/api/lobbies?page=999')).body._embedded.lobbies).toEqual([]);
    for (const body of [created.body, list.body, (await owner.agent.get(path(created.body.id))).body]) {
      const serialized = JSON.stringify(body);
      for (const forbidden of ['invitationHash','passwordHash','email','usernameKey']) expect(serialized).not.toContain(forbidden);
    }
  });

  it('hides private lobbies and returns their invitation only once, letting a valid guest join', async () => {
    const f = await lobbyFixture(); const owner = await f.client('Owner'); const guest = await f.client('Guest');
    const created = await owner.post('/api/lobbies', { ...settings, visibility: 'PRIVATE' }); const id = created.body.id;
    expect(created.body.invitationCode).toMatch(/^[A-F0-9]{24}$/);
    expect(f.data.get(id)!.invitationHash).not.toBe(created.body.invitationCode);
    expect((await guest.agent.get('/api/lobbies')).body.total).toBe(0);
    expect((await guest.agent.get(path(id))).status).toBe(404);
    expect((await owner.agent.get(path(id))).body).not.toHaveProperty('invitationCode');
    expect((await guest.post(`${path(id)}/memberships`)).status).toBe(404);
    expect((await guest.post(`${path(id)}/memberships`, { invitationCode: '0'.repeat(24) })).status).toBe(404);
    const joined = await guest.post(`${path(id)}/memberships`, { invitationCode: created.body.invitationCode.toLowerCase() });
    expect(joined.status).toBe(201); expect(joined.headers.location).toBe(`${path(id)}/memberships/me`);
    expect((await guest.agent.get(joined.headers.location!)).body.username).toBe('Guest');
    expect((await guest.agent.get(path(id))).body.memberCount).toBe(2);
    expect((await guest.post(`${path(id)}/memberships`)).status).toBe(409);
    expect((await guest.leave(id)).status).toBe(204);
    expect((await guest.agent.get(path(id))).status).toBe(404);
  });

  it('enforces capacity and refuses duplicate or unauthorized memberships', async () => {
    const f = await lobbyFixture(); const owner = await f.client('Owner');
    const id = (await owner.post('/api/lobbies', settings)).body.id;
    expect((await owner.post(`${path(id)}/memberships`)).body.code).toBe('ALREADY_MEMBER');
    for (const name of ['Guest','Other','Fourth','Fifth','Sixth']) {
      expect((await (await f.client(name)).post(`${path(id)}/memberships`)).status).toBe(201);
    }
    const last = await f.client('Seventh');
    expect((await last.post(`${path(id)}/memberships`)).body.code).toBe('LOBBY_FULL');
    expect((await last.leave(id)).status).toBe(404);
    expect((await last.agent.get(`${path(id)}/memberships/me`)).status).toBe(404);
    expect(f.data.get(id)!.members).toHaveLength(6);
  });

  it('transfers ownership to the earliest remaining member and closes an empty lobby', async () => {
    const f = await lobbyFixture(); const owner = await f.client('Owner'); const guest = await f.client('Guest'); const other = await f.client('Other');
    const id = (await owner.post('/api/lobbies', settings)).body.id;
    await guest.post(`${path(id)}/memberships`); await other.post(`${path(id)}/memberships`);
    expect((await owner.leave(id)).status).toBe(204);
    expect((await guest.agent.get(path(id))).body.owner.username).toBe('Guest');
    expect((await owner.leave(id)).status).toBe(404);
    await guest.leave(id); expect((await other.agent.get(path(id))).body.owner.username).toBe('Other');
    await other.leave(id); expect(f.data.get(id)!.status).toBe('CLOSED');
    expect((await other.agent.get('/api/lobbies')).body.total).toBe(0);
    expect((await owner.post(`${path(id)}/memberships`)).status).toBe(409);
  });

  it('rejects membership changes after launch without allowing a client to set the status', async () => {
    const f = await lobbyFixture(); const owner = await f.client('Owner'); const guest = await f.client('Guest');
    expect((await owner.post('/api/lobbies', { ...settings, status: 'IN_GAME' })).status).toBe(400);
    const id = (await owner.post('/api/lobbies', settings)).body.id; f.data.get(id)!.status = 'IN_GAME';
    expect((await owner.leave(id)).status).toBe(409);
    expect((await guest.post(`${path(id)}/memberships`)).status).toBe(409);
    expect((await guest.agent.get(path(id))).status).toBe(404);
    expect((await owner.agent.get(path(id))).status).toBe(200);
    expect((await owner.agent.get('/api/lobbies')).body.total).toBe(0);
  });

  it('validates settings, invitation format, identifiers and pagination boundaries', async () => {
    const f = await lobbyFixture(); const owner = await f.client('Owner');
    for (const body of [{ ...settings, capacity: 5 }, { ...settings, capacity: 13 }, { ...settings, discussionDurationSeconds: 29 },
      { ...settings, nightDurationSeconds: 301 }, { ...settings, voteDurationSeconds: 30.5 }, { ...settings, name: 'x' }]) {
      expect((await owner.post('/api/lobbies', body)).status).toBe(400);
    }
    expect((await owner.post('/api/lobbies', { ...settings, capacity: 12, discussionDurationSeconds: 30, voteDurationSeconds: 300 })).status).toBe(201);
    expect((await owner.agent.get('/api/lobbies/not-a-uuid')).status).toBe(400);
    expect((await owner.agent.get(path(randomUUID()))).status).toBe(404);
    expect((await owner.post(`${path(randomUUID())}/memberships`, { invitationCode: 'bad' })).status).toBe(400);
    for (const query of ['page=0','page=-1','pageSize=101','page=1.5','page=1&page=2','unknown=1','page=2147483647&pageSize=100']) {
      expect((await owner.agent.get(`/api/lobbies?${query}`)).status).toBe(400);
    }
    const ownerId = [...f.users.values()][0]!.id;
    await expect(f.service.create(ownerId, { ...settings, capacity: 0 })).rejects.toMatchObject({ code: 'INVALID_LOBBY' });
  });

  it('requires a valid authenticated session, Origin and CSRF token for mutations', async () => {
    const f = await lobbyFixture();
    expect((await request(f.app).get('/api/lobbies')).status).toBe(401);
    const anon = request.agent(f.app); const token = (await anon.get('/api/csrf')).body.csrfToken;
    expect((await anon.post('/api/lobbies').set('Origin',origin).set('X-CSRF-Token',token).send(settings)).status).toBe(401);
    const owner = await f.client('Owner');
    expect((await owner.agent.post('/api/lobbies').set('Origin',origin).send(settings)).status).toBe(403);
    expect((await owner.agent.post('/api/lobbies').set('Origin','https://evil.example').set('X-CSRF-Token',owner.csrf).send(settings)).status).toBe(403);
  });
});
