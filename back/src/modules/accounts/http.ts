import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import session, { type Store } from 'express-session';
import { z } from 'zod';
import { personalProfile } from './domain.js';
import type { AccountService } from './service.js';
import { HttpError } from '../../http/errors.js';
import { rateLimit, type RequestLimiter } from '../../http/rate-limit.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    issuedAt?: number;
  }
}

export interface AccountHttpOptions {
  service: AccountService;
  sessionStore: Store;
  limiter: RequestLimiter;
  secret: string;
  secureCookies: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  ttlSeconds: number;
  origin: string;
  now?: () => number;
}

const registration = z.strictObject({
  username: z.string().trim().regex(/^[A-Za-z0-9_]{3,24}$/),
  email: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(12).max(128),
});
const credentials = z.strictObject({ email: z.string().trim().email().max(254).toLowerCase(), password: z.string().min(1).max(128) });
const cookieName = 'loup.sid';

function save(req: Request) {
  return new Promise<void>((resolve, reject) => { req.session.save((error) => { if (error) reject(error); else resolve(); }); });
}
function regenerate(req: Request) {
  return new Promise<void>((resolve, reject) => { req.session.regenerate((error) => { if (error) reject(error); else resolve(); }); });
}
function destroy(req: Request) {
  return new Promise<void>((resolve, reject) => { req.session.destroy((error) => { if (error) reject(error); else resolve(); }); });
}

export function accountRouter(options: AccountHttpOptions) {
  const router = Router();
  const now = options.now ?? Date.now;
  const cookie = { httpOnly: true, secure: options.secureCookies, sameSite: options.sameSite, path: '/' } as const;
  const clearCookie = (res: Response) => { res.clearCookie(cookieName, cookie); };
  router.use(rateLimit(options.limiter, 'api', 300, 60_000));
  router.use(session({ name: cookieName, secret: options.secret, store: options.sessionStore,
    resave: false, saveUninitialized: false, rolling: false,
    cookie: { ...cookie, maxAge: options.ttlSeconds * 1000 } }));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(async (req, res, next) => {
    try {
      if (req.session.issuedAt !== undefined && now() - req.session.issuedAt >= options.ttlSeconds * 1000) {
        await destroy(req);
        clearCookie(res);
        throw new HttpError(401, 'SESSION_EXPIRED', 'Session expired; fetch a new CSRF token');
      }
      next();
    } catch (error) { next(error); }
  });
  router.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    if (req.get('origin') !== options.origin) {
      next(new HttpError(403, 'ORIGIN_FORBIDDEN', 'Origin not allowed')); return;
    }
    const provided = req.get('x-csrf-token');
    const expected = req.session.csrfToken;
    if (!provided || !expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      next(new HttpError(403, 'CSRF_INVALID', 'Invalid CSRF token')); return;
    }
    next();
  });

  router.get('/csrf', rateLimit(options.limiter, 'csrf', 30, 60_000), async (req, res) => {
    req.session.csrfToken ??= randomBytes(32).toString('hex');
    req.session.issuedAt ??= now();
    await save(req);
    res.json({ csrfToken: req.session.csrfToken });
  });
  router.post('/users', rateLimit(options.limiter, 'register', 5, 3_600_000), async (req, res) => {
    const input = registration.safeParse(req.body);
    if (!input.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid username, email or password');
    const user = await options.service.register(input.data);
    res.status(201).location(`/api/users/${user.id}`).type('application/hal+json').json({ ...personalProfile(user),
      _links: { self: { href: `/api/users/${user.id}` }, login: { href: '/api/sessions' } } });
  });
  router.post('/sessions', rateLimit(options.limiter, 'login', 10, 900_000), async (req, res) => {
    const input = credentials.safeParse(req.body);
    if (!input.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid email or password');
    const user = await options.service.login(input.data.email, input.data.password);
    await regenerate(req);
    req.session.userId = user.id;
    req.session.issuedAt = now();
    req.session.csrfToken = randomBytes(32).toString('hex');
    await save(req);
    res.status(201).location('/api/sessions/current').type('application/hal+json').json({
      user: personalProfile(user), csrfToken: req.session.csrfToken,
      _links: { self: { href: '/api/sessions/current' }, profile: { href: '/api/me' } },
    });
  });

  router.get(['/me', '/users/:userId'], async (req, res) => {
    if (!req.session.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (req.params.userId && req.params.userId !== req.session.userId) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }
    const user = await options.service.profile(req.session.userId);
    if (!user) {
      await destroy(req); clearCookie(res);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    res.type('application/hal+json').json({ ...personalProfile(user), _links: { self: { href: req.params.userId ? `/api/users/${user.id}` : '/api/me' } } });
  });
  router.get('/sessions/current', (req, res) => {
    if (!req.session.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    res.type('application/hal+json').json({ authenticated: true,
      expiresAt: new Date((req.session.issuedAt ?? now()) + options.ttlSeconds * 1000).toISOString(),
      _links: { self: { href: '/api/sessions/current' }, profile: { href: '/api/me' } } });
  });
  router.delete('/sessions/current', async (req, res) => {
    if (!req.session.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    await destroy(req); clearCookie(res); res.status(204).end();
  });
  return router;
}
