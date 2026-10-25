import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { WebSocket, WebSocketServer } from 'ws';
import { diagnostic } from '../diagnostics.ts';
import type { WsAdapter, WsAdapterOptions, WsConnection } from './adapter.ts';

const GOING_AWAY = 1001;
const CLOSE_GRACE_MS = 1_000;

function rejectUpgrade(socket: Duplex, status: number) {
  if (socket.writable) {
    socket.write(
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
  }
  socket.destroy();
}

async function loadWs() {
  try {
    return await import('ws');
  } catch (error) {
    throw new Error(diagnostic('ws.missingPackage'), { cause: error });
  }
}

function toConnection(ws: WebSocket): WsConnection {
  return {
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    send: (message) => ws.send(message),
    close: (code, reason) => ws.close(code, reason),
    terminate: () => ws.terminate(),
    onMessage: (listener) =>
      ws.on('message', (data, isBinary) => listener(isBinary ? '' : data.toString(), isBinary)),
    onClose: (listener) => ws.on('close', (code, reason) => listener(code, reason.toString())),
  };
}

export function createWsAdapter(): WsAdapter {
  let wss: WebSocketServer | undefined;
  let httpServer: Server | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let onUpgrade: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;

  return {
    async attach(server: Server, options: WsAdapterOptions) {
      const { WebSocketServer } = await loadWs();
      const alive = new WeakMap<WebSocket, boolean>();
      const sockets = new WebSocketServer({
        noServer: true,
        maxPayload: options.maxPayload,
        perMessageDeflate: false,
      });

      onUpgrade = (req, socket, head) => {
        socket.on('error', () => socket.destroy());
        options.verify(req).then(
          (verdict) => {
            if (verdict.action === 'ignore') {
              if (server.listenerCount('upgrade') === 1) {
                rejectUpgrade(socket, verdict.status ?? 404);
              }
              return;
            }
            if (verdict.action === 'reject') return rejectUpgrade(socket, verdict.status);

            sockets.handleUpgrade(req, socket, head, (ws) => {
              alive.set(ws, true);
              ws.on('pong', () => alive.set(ws, true));
              ws.on('error', () => ws.terminate());
              options.onConnection(toConnection(ws), req);
            });
          },
          () => rejectUpgrade(socket, 500)
        );
      };

      heartbeat = setInterval(() => {
        for (const ws of sockets.clients) {
          if (!alive.get(ws)) {
            ws.terminate();
            continue;
          }
          alive.set(ws, false);
          ws.ping();
        }
      }, options.heartbeatMs);
      heartbeat.unref();

      server.on('upgrade', onUpgrade);
      wss = sockets;
      httpServer = server;
    },

    async close() {
      clearInterval(heartbeat);
      if (onUpgrade) httpServer?.off('upgrade', onUpgrade);
      if (!wss) return;

      const clients = [...wss.clients];
      const closed = Promise.all(
        clients.map(
          (ws) =>
            new Promise<void>((resolve) => {
              if (ws.readyState === ws.CLOSED) return resolve();
              ws.once('close', () => resolve());
              ws.close(GOING_AWAY);
            })
        )
      );
      await Promise.race([closed, delay(CLOSE_GRACE_MS, undefined, { ref: false })]);
      for (const ws of clients) ws.terminate();

      const server = wss;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      wss = undefined;
    },
  };
}
