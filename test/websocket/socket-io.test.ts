import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { io as connectClient, type Socket } from 'socket.io-client';
import { z } from 'zod';
import { Module, Public, createApp, inject, silentLogger, type App, type AnyConstructor } from '../../src/index.ts';
import {
  Gateway,
  OnMessage,
  WebSocketModule,
  WsServer,
  type WebSocketOptions,
  type WsContext,
} from '../../src/websocket/index.ts';
import { createSocketIoAdapter } from './socket-io-adapter.ts';

interface Message {
  event: string;
  data?: any;
  id?: string | number;
}

interface TestClient {
  socket: Socket;
  next(): Promise<Message>;
  request(event: string, data?: unknown, id?: string | number): Promise<Message>;
}

let running: App | undefined;
const clients: Socket[] = [];

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await running?.close();
  running = undefined;
});

async function start(modules: AnyConstructor[], options: WebSocketOptions = {}) {
  @Module({
    imports: [WebSocketModule.forRoot({ adapter: createSocketIoAdapter(), ...options }), ...modules],
  })
  class RootModule {}

  const app = createApp({ rootModule: RootModule, logger: silentLogger });
  const server = await app.listen(0, '127.0.0.1');
  running = app;
  const { port } = server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

function waitFor(socket: Socket, event: 'connect' | 'connect_error' | 'disconnect') {
  return new Promise<void>((resolve) => socket.once(event, () => resolve()));
}

function open(url: string, path: string, headers: Record<string, string> = {}) {
  const socket = connectClient(url, {
    path,
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: headers,
  });
  clients.push(socket);
  return socket;
}

async function connect(
  url: string,
  path: string,
  headers?: Record<string, string>
): Promise<TestClient> {
  const socket = open(url, path, headers);
  const queued: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];

  socket.on('message', (raw: string) => {
    const message = JSON.parse(raw) as Message;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  await waitFor(socket, 'connect');

  const next = () =>
    new Promise<Message>((resolve) => {
      const message = queued.shift();
      if (message) resolve(message);
      else waiting.push(resolve);
    });

  return {
    socket,
    next,
    request(event, data, id) {
      socket.send(JSON.stringify({ event, data, id }));
      return next();
    },
  };
}

const Echo = z.object({ text: z.string().min(1) });
const Room = z.object({ room: z.string() });
const Say = z.object({ room: z.string(), text: z.string() });

@Public()
@Gateway('/chat')
class ChatGateway {
  private readonly server = inject(WsServer);

  @OnMessage('echo', Echo)
  echo({ data }: WsContext<typeof Echo>) {
    return data;
  }

  @OnMessage('join', Room)
  join({ client, data }: WsContext<typeof Room>) {
    client.join(data.room);
    return client.rooms.size;
  }

  @OnMessage('say', Say)
  say({ client, data }: WsContext<typeof Say>) {
    this.server.to(data.room).send('said', data.text, { except: client });
  }
}

@Gateway('/private')
class PrivateGateway {
  @OnMessage('whoami', z.undefined())
  whoami({ client }: WsContext) {
    return client.state;
  }
}

@Module({ providers: [ChatGateway, PrivateGateway] })
class ChatModule {}

describe('WsAdapter con socket.io', () => {
  it('atiende mensajes con el mismo formato que el adaptador de ws', async () => {
    const { url } = await start([ChatModule]);
    const client = await connect(url, '/chat');

    assert.deepEqual(await client.request('echo', { text: 'hola' }, 'a1'), {
      event: 'echo',
      data: { text: 'hola' },
      id: 'a1',
    });

    const invalid = await client.request('echo', { text: '' }, 2);
    assert.equal(invalid.event, 'error');
    assert.equal(invalid.data.code, 'errors.validation');
    assert.equal(invalid.id, 2);
  });

  it('las salas de viga funcionan igual sobre socket.io', async () => {
    const { url } = await start([ChatModule]);
    const [ana, beto, caro] = await Promise.all([
      connect(url, '/chat'),
      connect(url, '/chat'),
      connect(url, '/chat'),
    ]);

    await ana.request('join', { room: 'soporte' });
    await beto.request('join', { room: 'soporte' });
    ana.socket.send(JSON.stringify({ event: 'say', data: { room: 'soporte', text: 'hola' } }));

    assert.deepEqual(await beto.next(), { event: 'said', data: 'hola' });
    const caroReceived = await Promise.race([
      caro.next().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    assert.equal(caroReceived, false);
  });

  it('autentica en el handshake y rechaza a quien no pasa', async () => {
    const { url } = await start([ChatModule], {
      authenticate: (req) => req.headers.authorization === 'Bearer ok' && { userId: 7 },
    });

    const rejected = open(url, '/private', { authorization: 'Bearer mal' });
    await waitFor(rejected, 'connect_error');

    const client = await connect(url, '/private', { authorization: 'Bearer ok' });
    assert.deepEqual((await client.request('whoami')).data, { userId: 7 });
  });

  it('close() desconecta a los clientes y la app termina', async () => {
    const { app, url } = await start([ChatModule]);
    const client = await connect(url, '/chat');
    const disconnected = waitFor(client.socket, 'disconnect');

    await app.close();
    running = undefined;

    await disconnected;
    assert.equal(app.get(WsServer).clients.size, 0);
  });

  it('respeta maxPayload', async () => {
    const { url } = await start([ChatModule], { maxPayload: 64 });
    const client = await connect(url, '/chat');
    const disconnected = waitFor(client.socket, 'disconnect');

    client.socket.send(JSON.stringify({ event: 'echo', data: { text: 'x'.repeat(500) } }));

    await disconnected;
  });
});
