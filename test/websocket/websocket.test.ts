import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { z } from 'zod';
import {
  Controller,
  Get,
  Module,
  Public,
  UseGuards,
  createApp,
  inject,
  silentLogger,
  type App,
  type AnyConstructor,
} from '../../src/index.ts';
import {
  Gateway,
  OnMessage,
  WebSocketModule,
  WsServer,
  type OnWsConnection,
  type OnWsDisconnect,
  type WebSocketOptions,
  type WsClient,
  type WsContext,
} from '../../src/websocket/index.ts';

interface Message {
  event: string;
  data?: any;
  id?: string | number;
}

interface TestSocket {
  ws: WebSocket;
  next(): Promise<Message>;
  send(message: unknown): void;
  request(event: string, data?: unknown, id?: string | number): Promise<Message>;
}

let running: App | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(
  modules: AnyConstructor[],
  options: WebSocketOptions = {}
): Promise<{ app: App; url: string }> {
  @Module({ imports: [WebSocketModule.forRoot(options), ...modules] })
  class RootModule {}

  const app = createApp({ rootModule: RootModule, logger: silentLogger });
  const server = await app.listen(0, '127.0.0.1');
  running = app;
  const { port } = server.address() as AddressInfo;
  return { app, url: `ws://127.0.0.1:${port}` };
}

async function connect(url: string, headers: Record<string, string> = {}): Promise<TestSocket> {
  const ws = new WebSocket(url, { headers });
  const queued: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];

  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw)) as Message;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  await once(ws, 'open');

  const next = () =>
    new Promise<Message>((resolve) => {
      const message = queued.shift();
      if (message) resolve(message);
      else waiting.push(resolve);
    });
  const send = (message: unknown) =>
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));

  return {
    ws,
    next,
    send,
    request(event, data, id) {
      send({ event, data, id });
      return next();
    },
  };
}

async function handshakeStatus(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  ws.on('error', () => undefined);
  const [, response] = (await once(ws, 'unexpected-response')) as [unknown, { statusCode: number }];
  ws.terminate();
  return response.statusCode;
}

const Echo = z.object({ text: z.string().min(1) });
const Count = z.object({ to: z.number().int().max(5) });

@Public()
@Gateway('/echo')
class EchoGateway {
  @OnMessage('echo', Echo)
  echo({ data }: WsContext<typeof Echo>) {
    return { text: data.text };
  }

  @OnMessage('fail', z.undefined())
  fail(): never {
    throw new Error('secreto interno');
  }

  @OnMessage('count', Count)
  async *count({ data }: WsContext<typeof Count>) {
    for (let i = 1; i <= data.to; i++) yield i;
  }

  @OnMessage('admin', z.undefined())
  @UseGuards((ctx: WsContext) => ctx.client.state.role === 'admin')
  admin() {
    return 'ok';
  }
}

@Module({ providers: [EchoGateway] })
class EchoModule {}

describe('viga/websocket', () => {
  describe('handshake', () => {
    @Gateway('/private')
    class PrivateGateway {
      @OnMessage('whoami', z.undefined())
      whoami({ client }: WsContext) {
        return client.state;
      }
    }

    @Module({ providers: [PrivateGateway] })
    class PrivateModule {}

    it('acepta un gateway @Public sin autenticación', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      assert.equal(socket.ws.readyState, WebSocket.OPEN);
      socket.ws.close();
    });

    it('rechaza con 401 un gateway privado si no hay authenticate', async () => {
      const { url } = await start([PrivateModule]);

      assert.equal(await handshakeStatus(`${url}/private`), 401);
    });

    it('usa authenticate y guarda lo que devuelve en client.state', async () => {
      const { url } = await start([PrivateModule], {
        authenticate: (req) => req.headers.authorization === 'Bearer ok' && { userId: 7 },
      });

      assert.equal(await handshakeStatus(`${url}/private`, { authorization: 'Bearer mal' }), 401);

      const socket = await connect(`${url}/private`, { authorization: 'Bearer ok' });
      assert.deepEqual(await socket.request('whoami'), { event: 'whoami', data: { userId: 7 } });
      socket.ws.close();
    });

    it('rechaza con 403 un Origin que no está permitido', async () => {
      const { url } = await start([EchoModule], { allowedOrigins: ['https://app.example'] });

      assert.equal(await handshakeStatus(`${url}/echo`, { origin: 'https://evil.example' }), 403);
      const allowed = await connect(`${url}/echo`, { origin: 'https://app.example' });
      const withoutOrigin = await connect(`${url}/echo`);
      allowed.ws.close();
      withoutOrigin.ws.close();
    });

    it('por defecto rechaza cualquier Origin de navegador', async () => {
      const { url } = await start([EchoModule]);

      assert.equal(await handshakeStatus(`${url}/echo`, { origin: 'https://app.example' }), 403);
    });

    it('responde 404 a una ruta sin gateway', async () => {
      const { url } = await start([EchoModule]);

      assert.equal(await handshakeStatus(`${url}/nope`), 404);
    });
  });

  describe('mensajes', () => {
    it('responde con el mismo evento y el id del mensaje', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      assert.deepEqual(await socket.request('echo', { text: 'hola' }, 'a1'), {
        event: 'echo',
        data: { text: 'hola' },
        id: 'a1',
      });
      socket.ws.close();
    });

    it('valida los datos y responde el error con los detalles', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      const reply = await socket.request('echo', { text: '' }, 1);

      assert.equal(reply.event, 'error');
      assert.equal(reply.id, 1);
      assert.equal(reply.data.statusCode, 400);
      assert.equal(reply.data.code, 'errors.validation');
      assert.equal(reply.data.details.data[0].path, 'text');
      socket.ws.close();
    });

    it('rechaza JSON inválido, eventos desconocidos y mensajes binarios', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      socket.send('{no es json');
      assert.equal((await socket.next()).data.code, 'errors.badRequest');
      socket.send({ event: 'echo', id: { malo: true } });
      assert.equal((await socket.next()).data.code, 'errors.badRequest');
      assert.equal((await socket.request('nope')).data.code, 'errors.notFound');
      socket.ws.send(Buffer.from([1, 2, 3]), { binary: true });
      assert.equal((await socket.next()).data.code, 'errors.unsupportedMediaType');
      socket.ws.close();
    });

    it('no filtra el mensaje de un error inesperado', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      const reply = await socket.request('fail');

      assert.equal(reply.data.statusCode, 500);
      assert.equal(reply.data.code, 'errors.internal');
      assert.doesNotMatch(JSON.stringify(reply), /secreto/);
      socket.ws.close();
    });

    it('envía un mensaje por cada valor de un async generator', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      socket.send({ event: 'count', data: { to: 3 } });
      const values = [await socket.next(), await socket.next(), await socket.next()];

      assert.deepEqual(
        values.map((message) => message.data),
        [1, 2, 3]
      );
      socket.ws.close();
    });

    it('deja de iterar un async generator cuando el cliente se desconecta', async () => {
      let produced = 0;

      @Public()
      @Gateway('/stream')
      class StreamGateway {
        @OnMessage('ticks', z.undefined())
        async *ticks() {
          while (true) {
            produced++;
            yield produced;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }
      }

      @Module({ providers: [StreamGateway] })
      class StreamModule {}

      const { url } = await start([StreamModule]);
      const socket = await connect(`${url}/stream`);
      socket.send({ event: 'ticks' });
      await socket.next();

      socket.ws.close();
      await once(socket.ws, 'close');
      await new Promise((resolve) => setTimeout(resolve, 50));
      const afterClose = produced;
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.ok(produced - afterClose <= 1, `siguió produciendo: ${produced - afterClose}`);
    });

    it('responde errors.internal sin tumbar el proceso si resolveMessage falla', async () => {
      const { url } = await start([EchoModule], {
        resolveMessage: () => {
          throw new Error('roto');
        },
      });
      const socket = await connect(`${url}/echo`);

      const reply = await socket.request('nope', undefined, 'x');

      assert.deepEqual(reply.data, {
        statusCode: 500,
        code: 'errors.internal',
        message: 'An unexpected error occurred',
      });
      assert.equal(reply.id, 'x');
      assert.deepEqual(await socket.request('echo', { text: 'sigo vivo' }), {
        event: 'echo',
        data: { text: 'sigo vivo' },
      });
      socket.ws.close();
    });

    it('aplica @UseGuards por mensaje', async () => {
      const { url } = await start([EchoModule]);
      const socket = await connect(`${url}/echo`);

      const reply = await socket.request('admin');

      assert.equal(reply.data.statusCode, 403);
      socket.ws.close();
    });

    it('limita los mensajes por conexión', async () => {
      const { url } = await start([EchoModule], { messageRateLimit: { max: 2, windowMs: 60_000 } });
      const socket = await connect(`${url}/echo`);

      await socket.request('echo', { text: '1' });
      await socket.request('echo', { text: '2' });
      const third = await socket.request('echo', { text: '3' });

      assert.equal(third.data.statusCode, 429);
      socket.ws.close();
    });

    it('cierra la conexión si un mensaje supera maxPayload', async () => {
      const { url } = await start([EchoModule], { maxPayload: 64 });
      const socket = await connect(`${url}/echo`);

      socket.send({ event: 'echo', data: { text: 'x'.repeat(200) } });
      const [code] = (await once(socket.ws, 'close')) as [number];

      assert.equal(code, 1009);
    });
  });

  describe('salas', () => {
    const Room = z.object({ room: z.string().min(1) });
    const Say = z.object({ room: z.string(), text: z.string() });

    @Public()
    @Gateway('/chat')
    class ChatGateway {
      private readonly server = inject(WsServer);

      @OnMessage('join', Room)
      join({ client, data }: WsContext<typeof Room>) {
        client.join(data.room);
        return client.rooms.size;
      }

      @OnMessage('leave', Room)
      leave({ client, data }: WsContext<typeof Room>) {
        client.leave(data.room);
        return client.rooms.size;
      }

      @OnMessage('say', Say)
      say({ client, data }: WsContext<typeof Say>) {
        this.server.to(data.room).send('said', data.text, { except: client });
      }
    }

    @Module({ providers: [ChatGateway] })
    class ChatModule {}

    it('envía solo a los miembros de la sala, sin repetir al emisor', async () => {
      const { url } = await start([ChatModule]);
      const [ana, beto, caro] = await Promise.all([
        connect(`${url}/chat`),
        connect(`${url}/chat`),
        connect(`${url}/chat`),
      ]);

      await ana.request('join', { room: 'soporte' });
      await beto.request('join', { room: 'soporte' });
      await beto.request('join', { room: 'general' });
      await caro.request('join', { room: 'general' });

      ana.send({ event: 'say', data: { room: 'soporte', text: 'hola' } });

      assert.deepEqual(await beto.next(), { event: 'said', data: 'hola' });
      caro.send({ event: 'say', data: { room: 'general', text: 'otra sala' } });
      assert.deepEqual(await beto.next(), { event: 'said', data: 'otra sala' });
      for (const socket of [ana, beto, caro]) socket.ws.close();
    });

    it('un cliente puede estar en varias salas y salir de una', async () => {
      const { url } = await start([ChatModule]);
      const socket = await connect(`${url}/chat`);

      await socket.request('join', { room: 'a' });
      assert.equal((await socket.request('join', { room: 'b' })).data, 2);
      assert.equal((await socket.request('leave', { room: 'a' })).data, 1);
      socket.ws.close();
    });

    it('al desconectarse sale de todas sus salas', async () => {
      const { app, url } = await start([ChatModule]);
      const socket = await connect(`${url}/chat`);
      await socket.request('join', { room: 'a' });

      socket.ws.close();
      await once(socket.ws, 'close');
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(app.get(WsServer).clients.size, 0);
    });
  });

  describe('ciclo de vida', () => {
    it('llama a onConnection y onDisconnect, y close() cierra los clientes con 1001', async () => {
      const events: string[] = [];

      @Public()
      @Gateway('/life')
      class LifeGateway implements OnWsConnection, OnWsDisconnect {
        onConnection(client: WsClient) {
          events.push(`connect:${typeof client.id}`);
        }
        onDisconnect(_client: WsClient, code: number) {
          events.push(`disconnect:${code}`);
        }
      }

      @Module({ providers: [LifeGateway] })
      class LifeModule {}

      const { app, url } = await start([LifeModule]);
      const socket = await connect(`${url}/life`);
      const closed = once(socket.ws, 'close');

      await app.close();
      running = undefined;
      const [code] = (await closed) as [number];

      assert.equal(code, 1001);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(events, ['connect:string', 'disconnect:1001']);
    });

    it('con requireValidation, no arranca si un handler no tiene schema', async () => {
      @Public()
      @Gateway('/loose')
      class LooseGateway {
        @OnMessage('ping')
        ping() {
          return 'pong';
        }
      }

      @Module({ providers: [LooseGateway] })
      class LooseModule {}

      await assert.rejects(start([LooseModule]), /LooseGateway\.ping handles "ping" without a schema/);
      const { url } = await start([LooseModule], { requireValidation: false });
      const socket = await connect(`${url}/loose`);
      assert.deepEqual(await socket.request('ping'), { event: 'ping', data: 'pong' });
      socket.ws.close();
    });

    it('no arranca si dos gateways usan la misma ruta', async () => {
      @Public()
      @Gateway('/echo')
      class OtherEchoGateway {}

      @Module({ providers: [OtherEchoGateway] })
      class OtherModule {}

      await assert.rejects(start([EchoModule, OtherModule]), /use the same path \/echo/);
    });

    it('rechaza nombres de evento inválidos al declararlos', () => {
      assert.throws(() => OnMessage('con espacios'), /Invalid event name "con espacios"/);
    });

    it('convive con las rutas HTTP en el mismo puerto', async () => {
      @Public()
      @Controller('/health')
      class HealthController {
        @Get()
        check() {
          return { ok: true };
        }
      }

      @Module({ controllers: [HealthController] })
      class HttpModule {}

      const { url } = await start([EchoModule, HttpModule]);
      const response = await fetch(`${url.replace('ws', 'http')}/health`);
      const socket = await connect(`${url}/echo`);

      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(socket.ws.readyState, WebSocket.OPEN);
      socket.ws.close();
    });
  });
});
