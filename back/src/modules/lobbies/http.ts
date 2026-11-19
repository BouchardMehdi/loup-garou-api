import { Router } from 'express';
import { z } from 'zod';
import type { AccountService } from '../accounts/service.js';
import { HttpError } from '../../http/errors.js';
import { rateLimit, type RequestLimiter } from '../../http/rate-limit.js';
import { LobbyService, lobbySummary } from './service.js';
import type { Lobby } from './domain.js';

const duration = z.number().int().min(30).max(300);
const settings = z.strictObject({
  name: z.string().trim().min(3).max(80),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  capacity: z.number().int().min(6).max(12).default(12),
  discussionDurationSeconds: duration.default(180), voteDurationSeconds: duration.default(60), nightDurationSeconds: duration.default(60),
});
const joining = z.strictObject({ invitationCode: z.string().trim().regex(/^[A-Fa-f0-9]{24}$/).optional() });
const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647));
const pagination = z.strictObject({ page: positiveInteger.optional(), pageSize: positiveInteger.pipe(z.number().max(100)).optional() });
const lobbyId = z.uuid();
function id(value: unknown) {
  const result = lobbyId.safeParse(value);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid lobby identifier');
  return result.data;
}
function detail(lobby: Lobby) {
  return { ...lobbySummary(lobby), members: lobby.members.map((m) => ({ userId: m.userId, username: m.username, joinedAt: m.joinedAt.toISOString() })),
    _links: { self: { href: `/api/lobbies/${lobby.id}` }, membership: { href: `/api/lobbies/${lobby.id}/memberships/me` } } };
}
function membership(lobby: Lobby, userId: string) {
  const member = lobby.members.find((m) => m.userId === userId);
  if (!member) throw new HttpError(404, 'LOBBY_NOT_FOUND', 'Not found');
  return { id: member.id, lobbyId: lobby.id, userId, username: member.username, joinedAt: member.joinedAt.toISOString(),
    _links: { self: { href: `/api/lobbies/${lobby.id}/memberships/me` }, lobby: { href: `/api/lobbies/${lobby.id}` } } };
}

// Mounted only after the shared account router has applied session, expiry, CSRF and API rate limits.
export function lobbyRouter(options: { service: LobbyService; accounts: AccountService; limiter: RequestLimiter }) {
  const router = Router();
  router.use(async (req, _res, next) => {
    if (!req.session?.userId || !(await options.accounts.profile(req.session.userId))) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    next();
  });
  router.get('/lobbies', async (req, res) => {
    const query = pagination.safeParse(req.query);
    if (!query.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid pagination');
    const page = query.data.page ?? 1; const pageSize = query.data.pageSize ?? 25;
    if ((page - 1) * pageSize > 2147483647) throw new HttpError(400, 'VALIDATION_ERROR', 'Page offset too large');
    const result = await options.service.list(page, pageSize);
    const last = Math.max(1, Math.ceil(result.total / pageSize));
    const link = (p: number) => ({ href: `/api/lobbies?page=${p}&pageSize=${pageSize}` });
    res.type('application/hal+json').json({ page, pageSize, total: result.total,
      _embedded: { lobbies: result.lobbies.map((lobby) => ({ ...lobbySummary(lobby), _links: { self: { href: `/api/lobbies/${lobby.id}` } } })) },
      _links: { self: link(page), first: link(1), last: link(last),
        ...(page > 1 ? { prev: link(Math.min(page - 1, last)) } : {}), ...(page < last ? { next: link(page + 1) } : {}) } });
  });
  router.post('/lobbies', rateLimit(options.limiter, 'lobby-create', 10, 60_000), async (req, res) => {
    const input = settings.safeParse(req.body);
    if (!input.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid lobby settings');
    const created = await options.service.create(req.session.userId!, input.data);
    res.status(201).location(`/api/lobbies/${created.lobby.id}`).type('application/hal+json').json({
      ...detail(created.lobby), ...(created.invitationCode ? { invitationCode: created.invitationCode } : {}),
    });
  });
  router.get('/lobbies/:lobbyId', async (req, res) => {
    res.type('application/hal+json').json(detail(await options.service.get(id(req.params.lobbyId), req.session.userId!)));
  });
  router.post('/lobbies/:lobbyId/memberships', rateLimit(options.limiter, 'lobby-join', 10, 60_000), async (req, res) => {
    const input = joining.safeParse(req.body ?? {});
    if (!input.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid invitation code');
    const lobby = await options.service.join(id(req.params.lobbyId), req.session.userId!, input.data.invitationCode);
    res.status(201).location(`/api/lobbies/${lobby.id}/memberships/me`).type('application/hal+json').json(membership(lobby, req.session.userId!));
  });
  router.get('/lobbies/:lobbyId/memberships/me', async (req, res) => {
    const lobby = await options.service.get(id(req.params.lobbyId), req.session.userId!);
    res.type('application/hal+json').json(membership(lobby, req.session.userId!));
  });
  router.delete('/lobbies/:lobbyId/memberships/me', async (req, res) => {
    await options.service.leave(id(req.params.lobbyId), req.session.userId!); res.status(204).end();
  });
  return router;
}
