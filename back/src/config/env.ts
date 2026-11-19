import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  GAME_TICK_INTERVAL_MS:z.coerce.number().int().min(250).max(60000).default(1000),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  POSTGRES_PASSWORD: z.string().min(16),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(28800),
  SESSION_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  REDIS_URL: z.url().default('redis://redis:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(1),
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Field names only: never print environment values or secrets.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment fields: ${fields.join(', ')}`);
  }
  if (result.data.NODE_ENV === 'production' && !result.data.APP_ORIGIN.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use HTTPS in production');
  }
  if (result.data.SESSION_SAME_SITE === 'none' && result.data.NODE_ENV !== 'production') {
    throw new Error('SESSION_SAME_SITE=none requires production HTTPS cookies');
  }
  if (new URL(result.data.APP_ORIGIN).origin !== result.data.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be an origin without a path or trailing slash');
  }
  return result.data;
}
