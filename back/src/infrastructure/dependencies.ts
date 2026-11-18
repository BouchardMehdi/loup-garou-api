import { Pool } from 'pg';
import { createClient } from 'redis';
import { databaseUrl } from '../config/database-url.js';

export interface DependencyChecks {
  database: () => Promise<void>;
  redis: () => Promise<void>;
}

export function createDependencies(env: NodeJS.ProcessEnv, redisUrl: string) {
  // SQL is used only for readiness; future business repositories use Prisma.
  const pool = new Pool({ connectionString: databaseUrl(env), max: 5,
    connectionTimeoutMillis: 3000, query_timeout: 3000 });
  const redis = createClient({ url: redisUrl, disableOfflineQueue: true,
    socket: { connectTimeout: 3000 } });
  const checks: DependencyChecks = {
    database: async () => { await pool.query('SELECT 1'); },
    redis: async () => { await redis.ping(); },
  };
  return { pool, redis, checks };
}
