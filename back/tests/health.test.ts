import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = (database = async () => {}, redis = async () => {}) =>
  createApp({ origin: 'http://localhost:3009', trustProxyHops: 0, checks: { database, redis } });

describe('HTTP foundation', () => {
  it('returns a HAL liveness document', async () => {
    const response = await request(app()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/hal+json');
    expect(response.body._links.self.href).toBe('/api/health');
  });
  it('is ready only when both dependencies respond', async () => {
    expect((await request(app()).get('/api/ready')).status).toBe(200);
    for (const failed of ['database', 'redis']) {
      const fail = async () => { throw new Error('secret connection details'); };
      const response = await request(app(failed === 'database' ? fail : undefined,
        failed === 'redis' ? fail : undefined)).get('/api/ready');
      expect(response.status).toBe(503);
      expect(response.body.dependencies[failed]).toBe(false);
      expect(response.text).not.toContain('secret');
    }
  });
  it('serves OpenAPI and the interactive documentation', async () => {
    expect((await request(app()).get('/api/openapi.json')).body.openapi).toBe('3.0.3');
    expect((await request(app()).get('/api/docs/')).status).toBe(200);
  });
  it('does not reflect an untrusted origin', async () => {
    const response = await request(app()).get('/api/health').set('Origin', 'https://untrusted.example');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3009');
  });
  it('handles malformed JSON and unknown routes without stack traces', async () => {
    expect((await request(app()).post('/api/unknown').set('Content-Type', 'application/json').send('{')).status).toBe(400);
    expect((await request(app()).get('/')).status).toBe(404);
  });
});
