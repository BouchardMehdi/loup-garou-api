import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import type { DependencyChecks } from './infrastructure/dependencies.js';
import { accountRouter, type AccountHttpOptions } from './modules/accounts/http.js';
import { AccountError } from './modules/accounts/domain.js';
import { lobbyRouter } from './modules/lobbies/http.js';
import type { LobbyService } from './modules/lobbies/service.js';
import { gameRouter } from './modules/game/http.js';
import type { GameService } from './modules/game/service.js';
import { GameError } from './modules/game/domain.js';
import { LobbyError } from './modules/lobbies/domain.js';
import { HttpError } from './http/errors.js';
import { openApiDocument } from './http/openapi.js';

export function createApp(options: {
  origin: string; trustProxyHops: number; checks: DependencyChecks;
  games?: GameService; lobbies?: LobbyService; accounts?: AccountHttpOptions; nodeEnv?: string; onError?: () => void;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxyHops);
  app.use(helmet());
  app.use(cors({ origin: options.origin, credentials: true }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.type('application/hal+json').json({ status: 'ok',
      _links: { self: { href: '/api/health' }, readiness: { href: '/api/ready' } } });
  });
  app.get('/api/ready', async (_req, res) => {
    const results = await Promise.allSettled([options.checks.database(), options.checks.redis()]);
    const ready = results.every((result) => result.status === 'fulfilled');
    res.status(ready ? 200 : 503).type('application/hal+json').json({
      status: ready ? 'ready' : 'unavailable',
      dependencies: { database: results[0]?.status === 'fulfilled', redis: results[1]?.status === 'fulfilled' },
      _links: { self: { href: '/api/ready' } },
    });
  });
  app.get('/api/openapi.json', (_req, res) => { res.json(openApiDocument); });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  if (options.nodeEnv === 'development') app.use('/doc', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  if ((options.lobbies || options.games) && !options.accounts) throw new Error('Lobby routes require account security middleware');
  if (options.accounts) {
    app.use('/api', accountRouter(options.accounts));
    if (options.lobbies) app.use('/api', lobbyRouter({ service: options.lobbies, accounts: options.accounts.service, limiter: options.accounts.limiter }));
    if (options.games) app.use('/api', gameRouter({ service: options.games, accounts: options.accounts.service, limiter: options.accounts.limiter }));
  }
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof GameError) {
      const status=error.code==='GAME_NOT_FOUND' || error.code==='LOBBY_NOT_FOUND' ? 404 : error.code==='START_FORBIDDEN' ? 403 : 409;
      const messages={ GAME_NOT_FOUND: 'Game not found',LOBBY_NOT_FOUND: 'Lobby not found',START_FORBIDDEN: 'Only the lobby owner can start',
        LOBBY_NOT_WAITING: 'Lobby is not waiting',PLAYER_COUNT_INVALID: 'Game requires 6 to 12 players within lobby capacity',GAME_ALREADY_STARTED: 'Game already started' };
      res.status(status).json({ code: error.code,error: messages[error.code] }); return;
    }
    if (error instanceof LobbyError) {
      const status = error.code === 'LOBBY_NOT_FOUND' ? 404 : error.code === 'INVALID_LOBBY' ? 400 : 409;
      const messages = { LOBBY_NOT_FOUND: 'Lobby or membership not found', INVALID_LOBBY: 'Invalid lobby settings',
        LOBBY_FULL: 'Lobby is full', ALREADY_MEMBER: 'Already a member', LOBBY_NOT_WAITING: 'Lobby is not waiting' };
      res.status(status).json({ code: error.code, error: messages[error.code] }); return;
    }
    if (error instanceof AccountError) {
      const duplicate = error.code === 'ACCOUNT_EXISTS';
      res.status(duplicate ? 409 : 401).json({ code: error.code,
        error: duplicate ? 'An account with these details already exists' : 'Invalid email or password' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ code: error.code, error: error.message });
      return;
    }
    const status = error instanceof SyntaxError ? 400 :
      typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 500;
    if (status === 500) options.onError?.();
    res.status(status).json({ error: status === 400 ? 'Invalid JSON' : status === 413 ? 'Payload too large' : 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}
