import { Server as SocketIoServer, type Socket } from 'socket.io';
import type { WsAdapter, WsConnection } from '../../src/websocket/index.ts';

const NORMAL_CLOSURE = 1000;
const GOING_AWAY = 1001;

interface EngineTransport {
  socket?: { bufferedAmount?: number };
}

export function createSocketIoAdapter(): WsAdapter {
  const servers: SocketIoServer[] = [];
  let closing = false;

  const toConnection = (socket: Socket): WsConnection => ({
    get bufferedAmount() {
      const { transport } = socket.conn as unknown as { transport?: EngineTransport };
      return transport?.socket?.bufferedAmount ?? 0;
    },
    send: (message) => {
      socket.send(message);
    },
    close: () => {
      socket.disconnect(true);
    },
    terminate: () => {
      socket.conn.close();
    },
    onMessage: (listener) =>
      socket.on('message', (data: unknown) => {
        if (typeof data === 'string') listener(data, false);
        else listener('', true);
      }),
    onClose: (listener) =>
      socket.on('disconnect', (reason) => listener(closing ? GOING_AWAY : NORMAL_CLOSURE, reason)),
  });

  return {
    attach(server, options) {
      for (const path of options.paths) {
        const io = new SocketIoServer(server, {
          path,
          transports: ['websocket'],
          serveClient: false,
          destroyUpgrade: false,
          maxHttpBufferSize: options.maxPayload,
          pingInterval: options.heartbeatMs,
          allowRequest: (req, done) => {
            options.verify(req).then(
              (verdict) => done(null, verdict.action === 'accept'),
              () => done(null, false)
            );
          },
        });
        io.on('connection', (socket) => options.onConnection(toConnection(socket), socket.request));
        servers.push(io);
      }
    },

    close() {
      closing = true;
      for (const io of servers) {
        io.disconnectSockets(true);
        io.engine.close();
      }
      servers.length = 0;
    },
  };
}
