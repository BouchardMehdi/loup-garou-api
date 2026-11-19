import { Router } from 'express';
import { z } from 'zod';
import type { AccountService } from '../accounts/service.js';
import { HttpError } from '../../http/errors.js';
import { rateLimit, type RequestLimiter } from '../../http/rate-limit.js';
import { GameService,publicGame } from './service.js';

function identifier(value: unknown) {
  const result=z.uuid().safeParse(value);
  if (!result.success) throw new HttpError(400,'VALIDATION_ERROR','Invalid identifier');
  return result.data;
}
export function gameRouter(options: { service: GameService; accounts: AccountService; limiter: RequestLimiter }) {
  const router=Router();
  router.use(async (req,_res,next) => {
    if (!req.session?.userId || !(await options.accounts.profile(req.session.userId))) throw new HttpError(401,'UNAUTHENTICATED','Authentication required');
    next();
  });
  router.post('/lobbies/:lobbyId/games',rateLimit(options.limiter,'game-start',10,60000),async (req,res) => {
    if (!z.strictObject({}).safeParse(req.body ?? {}).success) throw new HttpError(400,'VALIDATION_ERROR','Game start accepts no client settings or roles');
    const game=await options.service.start(identifier(req.params.lobbyId),req.session.userId!);
    res.status(201).location(`/api/games/${game.id}`).type('application/hal+json').json(publicGame(game));
  });
  router.get('/games/:gameId',async (req,res) => {
    res.type('application/hal+json').json(publicGame(await options.service.get(identifier(req.params.gameId),req.session.userId!)));
  });
  router.get('/games/:gameId/participants/me',async (req,res) => {
    const personal=await options.service.personal(identifier(req.params.gameId),req.session.userId!);
    res.type('application/hal+json').json({ ...personal,_links: { self: { href: `/api/games/${personal.gameId}/participants/me` },game: { href: `/api/games/${personal.gameId}` } } });
  });
  return router;
}
