import { createServer } from 'node:http';
import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDependencies } from './infrastructure/dependencies.js';
import { createRealtimeServer } from './realtime/index.js';

const config = loadConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });
const deps = createDependencies(process.env, config.REDIS_URL);
// No connection strings, request headers, bodies or secret roles in logs.
deps.redis.on('error', () => { logger.error('Redis connection error'); });
deps.pool.on('error', () => { logger.error('PostgreSQL pool error'); });
const app = createApp({ origin: config.APP_ORIGIN, trustProxyHops: config.TRUST_PROXY_HOPS, checks: deps.checks });
const http = createServer(app);
const io = createRealtimeServer(http, config.APP_ORIGIN);
http.on('request', (req, res) => {
  const start = performance.now();
  res.on('finish', () => {
    logger.info({ method: req.method, path: req.url?.split('?')[0], statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - start) }, 'HTTP request');
  });
});
await deps.redis.connect();
http.listen(config.PORT, config.HOST, () => { logger.info({ port: config.PORT }, 'API listening'); });
http.on('error', () => { logger.fatal('HTTP server failed'); process.exit(1); });
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  logger.info('Shutting down');
  const timer = setTimeout(() => { process.exit(1); }, 10_000);
  timer.unref();
  io.close(() => {
    void Promise.allSettled([deps.pool.end(), deps.redis.close()]).then(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
