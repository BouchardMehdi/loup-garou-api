import { expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { databaseUrl } from '../src/config/database-url.js';

it('rejects invalid configuration without leaking the value', () => {
  expect(() => loadConfig({ APP_ORIGIN: 'secret-value', POSTGRES_PASSWORD: 'short-secret', SESSION_SECRET: 'unit-test-session-secret-at-least-32-characters' }))
    .toThrow('Invalid environment fields: APP_ORIGIN, POSTGRES_PASSWORD');
});
it('encodes database credentials containing URL punctuation', () => {
  const url = new URL(databaseUrl({ POSTGRES_PASSWORD: 'a@b:c/d#e%', POSTGRES_USER: 'user' }));
  expect(decodeURIComponent(url.password)).toBe('a@b:c/d#e%');
  expect(url.hostname).toBe('db');
});

const valid = { APP_ORIGIN: 'https://api.example.test', POSTGRES_PASSWORD: 'valid-test-password', SESSION_SECRET: 'valid-test-session-secret-at-least-32-characters' };
it('requires a session secret and HTTPS for production', () => {
  expect(() => loadConfig({ ...valid, SESSION_SECRET: '' })).toThrow('SESSION_SECRET');
  expect(() => loadConfig({ ...valid, APP_ORIGIN: 'http://api.example.test' })).toThrow('HTTPS');
  expect(() => loadConfig({ ...valid, APP_ORIGIN: 'https://api.example.test/path' })).toThrow('origin');
  expect(() => loadConfig({ ...valid, NODE_ENV: 'development', SESSION_SAME_SITE: 'none' })).toThrow('HTTPS');
});
