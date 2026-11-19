import {GameEngine} from './modules/game/engine.js';
import {prismaEngine} from './modules/game/engine-repository.js';
import {startGameScheduler} from './modules/game/scheduler.js';
import { createServer } from 'node:http';
import pino from 'pino';
import { RedisStore } from 'connect-redis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { prismaUsers, argonPasswords } from './modules/accounts/infrastructure.js';
import { AccountService } from './modules/accounts/service.js';
import { LobbyService } from './modules/lobbies/service.js';
import { prismaLobbies } from './modules/lobbies/infrastructure.js';
import { GameService } from './modules/game/service.js';
import { prismaGames } from './modules/game/infrastructure.js';
import { redisLimiter } from './http/rate-limit.js';
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
await deps.redis.connect();
const prisma = new PrismaClient({ adapter: new PrismaPg(deps.pool) });
const service = await AccountService.create(prismaUsers(prisma), argonPasswords);
const engine=new GameEngine(prismaEngine(prisma));
const scheduler=startGameScheduler(engine,config.GAME_TICK_INTERVAL_MS,()=>{logger.error('Game phase processing failed');});
const app = createApp({ origin: config.APP_ORIGIN, trustProxyHops: config.TRUST_PROXY_HOPS,
  engine,
  games: new GameService(prismaGames(prisma)),
  lobbies: new LobbyService(prismaLobbies(prisma)),
  nodeEnv: config.NODE_ENV, checks: deps.checks, onError: () => { logger.error('Unhandled HTTP error'); },
  accounts: { service, sessionStore: new RedisStore({ client: deps.redis, prefix: 'loup:session:', disableTouch: true }),
    limiter: redisLimiter(deps.redis), secret: config.SESSION_SECRET,
    secureCookies: config.NODE_ENV === 'production', sameSite: config.SESSION_SAME_SITE,
    ttlSeconds: config.SESSION_TTL_SECONDS, origin: config.APP_ORIGIN },
});
const http = createServer(app);
const io = createRealtimeServer(http, config.APP_ORIGIN);
http.on('request', (req, res) => {
  const start = performance.now();
  res.on('finish', () => {
    logger.info({ method: req.method, path: req.url?.split('?')[0], statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - start) }, 'HTTP request');
  });
});
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
    void scheduler.stop().then(()=>prisma.$disconnect()).then(() => Promise.allSettled([deps.pool.end(), deps.redis.close()])).then(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
