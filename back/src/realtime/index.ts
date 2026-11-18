import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';

export function createRealtimeServer(server: HttpServer, origin: string) {
  const io = new Server(server, {
    path: '/socket.io', cors: { origin, credentials: true },
    maxHttpBufferSize: 32 * 1024,
  });
  // Closed until server-side session authentication and chat authorization exist.
  // Never expose a generic event allowing the client to choose a room.
  io.use((_socket, next) => { next(new Error('Authentication not implemented')); });
  return io;
}
