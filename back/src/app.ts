import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import type { DependencyChecks } from './infrastructure/dependencies.js';
import { openApiDocument } from './http/openapi.js';

export function createApp(options: {
  origin: string; trustProxyHops: number; checks: DependencyChecks;
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
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = error instanceof SyntaxError ? 400 :
      typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 500;
    res.status(status).json({ error: status === 400 ? 'Invalid JSON' : status === 413 ? 'Payload too large' : 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}
