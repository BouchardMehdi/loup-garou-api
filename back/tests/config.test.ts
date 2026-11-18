import { expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { databaseUrl } from '../src/config/database-url.js';

it('rejects invalid configuration without leaking the value', () => {
  expect(() => loadConfig({ APP_ORIGIN: 'secret-value', POSTGRES_PASSWORD: 'short-secret' }))
    .toThrow('Invalid environment fields: APP_ORIGIN, POSTGRES_PASSWORD');
});
it('encodes database credentials containing URL punctuation', () => {
  const url = new URL(databaseUrl({ POSTGRES_PASSWORD: 'a@b:c/d#e%', POSTGRES_USER: 'user' }));
  expect(decodeURIComponent(url.password)).toBe('a@b:c/d#e%');
  expect(url.hostname).toBe('db');
});
