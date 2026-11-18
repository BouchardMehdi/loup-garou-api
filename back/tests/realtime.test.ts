import { createServer } from 'node:http';
import { io as client } from 'socket.io-client';
import { expect, it } from 'vitest';
import { createRealtimeServer } from '../src/realtime/index.js';

it('refuses socket connections until authentication is implemented', async () => {
  const http = createServer();
  const io = createRealtimeServer(http, 'http://localhost');
  await new Promise<void>((resolve) => { http.listen(0, '127.0.0.1', resolve); });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port');
  const socket = client(`http://127.0.0.1:${address.port}`, { reconnection: false, transports: ['websocket'] });
  try {
    const error = await new Promise<Error>((resolve, reject) => {
      socket.on('connect_error', resolve);
      socket.on('connect', () => { reject(new Error('Unexpected authenticated connection')); });
    });
    expect(error.message).toBe('Authentication not implemented');
  } finally {
    socket.disconnect();
    await new Promise<void>((resolve) => { io.close(() => { resolve(); }); });
  }
});
