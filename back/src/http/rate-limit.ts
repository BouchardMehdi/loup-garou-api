import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HttpError } from './errors.js';

export interface RequestLimiter {
  consume(key: string, windowMs: number): Promise<{ count: number; retryAfterMs: number }>;
}

interface RedisEval {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const increment = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('PTTL', KEYS[1]) }
`;

export function redisLimiter(redis: RedisEval, prefix = 'loup:limit:'): RequestLimiter {
  return {
    async consume(key, windowMs) {
      const result = await redis.eval(increment, { keys: [`${prefix}${key}`], arguments: [String(windowMs)] });
      if (!Array.isArray(result)) throw new Error('Invalid rate limit response');
      return { count: Number(result[0]), retryAfterMs: Number(result[1]) };
    },
  };
}

export function rateLimit(limiter: RequestLimiter, scope: string, max: number, windowMs: number): RequestHandler {
  return async (req, res, next) => {
    try {
      const ip = createHash('sha256').update(req.ip ?? 'unknown').digest('hex');
      const result = await limiter.consume(`${scope}:${ip}`, windowMs);
      if (result.count > max) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
        throw new HttpError(429, 'RATE_LIMITED', 'Too many requests');
      }
      next();
    } catch (error) {
      next(error instanceof HttpError ? error : new HttpError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable'));
    }
  };
}
