import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { z } from 'zod';
import {
  Controller,
  ForbiddenException,
  Get,
  Module,
  Public,
  RateLimit as HttpRateLimit,
  UseGuards,
  UseInterceptors,
  createApp,
  inject,
  silentLogger,
  type App,
  type AnyConstructor,
  type AppOptions,
} from '../../src/index.ts';
import { I18n } from '../../src/i18n/index.ts';
import {
  Gateway,
  OnMessage,
  RateLimit,
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
  options: WebSocketOptions = {},
  appOptions: Omit<AppOptions, 'rootModule'> = {}
): Promise<{ app: App; url: string }> {
  @Module({ imports: [WebSocketModule.forRoot(options), ...modules] })
  class RootModule {}

  const app = createApp({ rootModule: RootModule, logger: silentLogger, ...appOptions });
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
  const status = await new Promise<number>((resolve) => {
    ws.once('unexpected-response', (_req, response) => resolve(response.statusCode ?? 0));
    ws.once('open', () => resolve(101));
  });
  ws.terminate();
  return status;
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

    it('rechaza con 503 si authenticate no responde a tiempo', async () => {
      const { url } = await start([PrivateModule], {
        authenticate: () => new Promise<boolean>(() => undefined),
        handshakeTimeoutMs: 50,
      });

      assert.equal(await handshakeStatus(`${url}/private`), 503);
    });

    it('rechaza con 503 cuando se alcanza maxConnections y acepta al liberarse', async () => {
      const { url } = await start([EchoModule], { maxConnections: 1 });
      const first = await connect(`${url}/echo`);

      assert.equal(await handshakeStatus(`${url}/echo`), 503);

      first.ws.close();
      await once(first.ws, 'close');
      await new Promise((resolve) => setImmediate(resolve));
      const second = await connect(`${url}/echo`);
      assert.equal(second.ws.readyState, WebSocket.OPEN);
      second.ws.close();
    });

    it('connectionsPerKey limita las conexiones por IP y libera el hueco al cerrar', async () => {
      const { url } = await start([EchoModule], { connectionsPerKey: { max: 2 } });
      const first = await connect(`${url}/echo`);
      const second = await connect(`${url}/echo`);

      assert.equal(await handshakeStatus(`${url}/echo`), 429);

      first.ws.close();
      await once(first.ws, 'close');
      await new Promise((resolve) => setImmediate(resolve));
      const third = await connect(`${url}/echo`);
      assert.equal(third.ws.readyState, WebSocket.OPEN);
      second.ws.close();
      third.ws.close();
    });

    it('connectionsPerKey usa la key propia y no limita cuando devuelve undefined', async () => {
      const { url } = await start([EchoModule], {
        connectionsPerKey: { max: 1, key: (req) => req.headers['x-client']?.toString() },
      });
      const ana = await connect(`${url}/echo`, { 'x-client': 'ana' });
      const beto = await connect(`${url}/echo`, { 'x-client': 'beto' });
      const anonymous = [await connect(`${url}/echo`), await connect(`${url}/echo`)];

      assert.equal(await handshakeStatus(`${url}/echo`, { 'x-client': 'ana' }), 429);
      for (const socket of [ana, beto, ...anonymous]) socket.ws.close();
    });

    it('por defecto limita a 50 las conexiones por IP', async () => {
      const { url } = await start([EchoModule]);
      const sockets = await Promise.all(Array.from({ length: 50 }, () => connect(`${url}/echo`)));

      assert.equal(await handshakeStatus(`${url}/echo`), 429);
      for (const socket of sockets) socket.ws.close();
    });

    it('con trustProxy cuenta por la IP real del cliente y agrupa IPv6 por /56', async () => {
      const { url } = await start([EchoModule], { connectionsPerKey: { max: 1 } }, { trustProxy: 1 });
      const first = await connect(`${url}/echo`, { 'x-forwarded-for': '2001:db8:aa:bb01::1' });

      assert.equal(await handshakeStatus(`${url}/echo`, { 'x-forwarded-for': '2001:db8:aa:bbff::9' }), 429);
      const other = await connect(`${url}/echo`, { 'x-forwarded-for': '198.51.100.7' });
      assert.equal(await handshakeStatus(`${url}/echo`, { 'x-forwarded-for': '::ffff:198.51.100.7' }), 429);
      first.ws.close();
      other.ws.close();
    });

    it('avisa una vez si llega X-Forwarded-For y trustProxy no está configurado', async () => {
      const warnings: string[] = [];
      const logger = { ...silentLogger, warn: (message: string) => warnings.push(message) };
      const { url } = await start([EchoModule], {}, { logger });
      const sockets = [
        await connect(`${url}/echo`, { 'x-forwarded-for': '198.51.100.7' }),
        await connect(`${url}/echo`, { 'x-forwarded-for': '198.51.100.8' }),
      ];

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /X-Forwarded-For/);
      for (const socket of sockets) socket.ws.close();
    });

    describe('handshakes pendientes', () => {
      const until = async (condition: () => boolean) => {
        while (!condition()) await new Promise((resolve) => setTimeout(resolve, 5));
      };

      const gated = () => {
        const gate = Promise.withResolvers<boolean>();
        const state = { calls: 0 };
        const authenticate = () => {
          state.calls++;
          return gate.promise;
        };
        return { gate, state, authenticate };
      };

      it('rechaza con 503 sin llamar a authenticate cuando se alcanza maxPendingHandshakes', async () => {
        const { gate, state, authenticate } = gated();
        const { url } = await start([PrivateModule], { authenticate, maxPendingHandshakes: 2 });
        const pending = [connect(`${url}/private`), connect(`${url}/private`)];
        await until(() => state.calls === 2);

        assert.equal(await handshakeStatus(`${url}/private`), 503);
        assert.equal(state.calls, 2);

        gate.resolve(true);
        for (const socket of await Promise.all(pending)) socket.ws.close();
      });

      it('connectionsPerKey cuenta también los handshakes que siguen autenticando', async () => {
        const { gate, state, authenticate } = gated();
        const { url } = await start([PrivateModule], { authenticate, connectionsPerKey: { max: 1 } });
        const pending = connect(`${url}/private`);
        await until(() => state.calls === 1);

        assert.equal(await handshakeStatus(`${url}/private`), 429);
        assert.equal(state.calls, 1);

        gate.resolve(true);
        (await pending).ws.close();
      });

      it('si el cliente corta mientras autentica, mantiene el hueco hasta que authenticate termina', async () => {
        const { gate, state, authenticate } = gated();
        const { app, url } = await start([PrivateModule], {
          authenticate,
          maxPendingHandshakes: 1,
          connectionsPerKey: { max: 1 },
        });
        const aborted = new WebSocket(`${url}/private`);
        aborted.on('error', () => undefined);
        await until(() => state.calls === 1);
        aborted.terminate();
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.equal(await handshakeStatus(`${url}/private`), 503);
        gate.resolve(true);
        await until(() => app.get(WsServer).clients.size === 0);
        await new Promise((resolve) => setTimeout(resolve, 20));

        const socket = await connect(`${url}/private`);
        assert.equal(socket.ws.readyState, WebSocket.OPEN);
        socket.ws.close();
      });

      it('con concealRoutes una ruta desconocida también ocupa un hueco pendiente', async () => {
        const { gate, state, authenticate } = gated();
        const { url } = await start(
          [PrivateModule],
          { authenticate, maxPendingHandshakes: 1 },
          { concealRoutes: true }
        );
        const unknown = handshakeStatus(`${url}/nope`);
        await until(() => state.calls === 1);

        assert.equal(await handshakeStatus(`${url}/private`), 503);
        assert.equal(await handshakeStatus(`${url}/nope`), 503);
        assert.equal(state.calls, 1);

        gate.resolve(true);
        assert.equal(await unknown, 404);
      });
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

    describe('con concealRoutes', () => {
      const options: WebSocketOptions = {
        authenticate: (req) => req.headers.authorization === 'Bearer ok',
        allowedOrigins: ['https://app.example'],
      };

      it('una ruta desconocida responde igual que un gateway privado', async () => {
        const { url } = await start([PrivateModule], options, { concealRoutes: true });

        assert.equal(await handshakeStatus(`${url}/private`), 401);
        assert.equal(await handshakeStatus(`${url}/nope`), 401);
        assert.equal(await handshakeStatus(`${url}/private`, { origin: 'https://evil.example' }), 403);
        assert.equal(await handshakeStatus(`${url}/nope`, { origin: 'https://evil.example' }), 403);
      });

      it('con sesión válida, una ruta desconocida responde 404', async () => {
        const { url } = await start([PrivateModule], options, { concealRoutes: true });

        assert.equal(await handshakeStatus(`${url}/nope`, { authorization: 'Bearer ok' }), 404);
        const socket = await connect(`${url}/private`, { authorization: 'Bearer ok' });
        socket.ws.close();
      });
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
      assert.equal(third.data.code, 'errors.tooManyRequests');
      assert.ok(third.data.details.retryAfter > 0);
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

  describe('orden del pipeline', () => {
    const Query = z.object({ q: z.string() });

    const fromCache = async (ctx: WsContext, next: () => Promise<unknown>) =>
      ctx.event === 'cached' ? 'desde caché' : next();

    @Public()
    @UseInterceptors(fromCache)
    @Gateway('/cached')
    class CachedGateway {
      @OnMessage('cached', Query)
      @UseGuards(() => false)
      cached() {
        return 'handler';
      }
    }

    @Module({ providers: [CachedGateway] })
    class CachedModule {}

    it('un interceptor del gateway que responde sin llamar a next no se salta los guards del evento', async () => {
      const { url } = await start([CachedModule]);
      const socket = await connect(`${url}/cached`);

      const reply = await socket.request('cached', { q: 'a' });
      assert.equal(reply.event, 'error');
      assert.equal(reply.data.statusCode, 403);
      socket.ws.close();
    });
  });

  describe('@RateLimit por handler', () => {
    const Query = z.object({ q: z.string() });

    @Public()
    @Gateway('/search')
    class SearchGateway {
      @OnMessage('search', Query)
      @RateLimit({ max: 2, windowMs: 60_000 })
      search({ data }: WsContext<typeof Query>) {
        return data.q;
      }

      @OnMessage('ping', z.undefined())
      ping() {
        return 'pong';
      }
    }

    @Module({ providers: [SearchGateway] })
    class SearchModule {}

    it('limita un evento sin afectar a los demás y devuelve retryAfter', async () => {
      const { url } = await start([SearchModule]);
      const socket = await connect(`${url}/search`);

      await socket.request('search', { q: '1' });
      await socket.request('search', { q: '2' });
      const limited = await socket.request('search', { q: '3' }, 'r3');

      assert.equal(limited.id, 'r3');
      assert.equal(limited.data.statusCode, 429);
      assert.ok(limited.data.details.retryAfter > 0);
      assert.deepEqual(await socket.request('ping'), { event: 'ping', data: 'pong' });
      socket.ws.close();
    });

    it('por defecto cuenta por conexión', async () => {
      const { url } = await start([SearchModule]);
      const first = await connect(`${url}/search`);
      const second = await connect(`${url}/search`);

      await first.request('search', { q: '1' });
      await first.request('search', { q: '2' });

      assert.equal((await second.request('search', { q: '1' })).data, '1');
      first.ws.close();
      second.ws.close();
    });

    it('con key cuenta por usuario aunque abra varias conexiones', async () => {
      @Gateway('/inbox')
      class InboxGateway {
        @OnMessage('invite', z.undefined())
        @RateLimit({ max: 1, windowMs: 60_000, key: ({ client }) => String(client.state.userId) })
        invite() {
          return 'sent';
        }
      }

      @Module({ providers: [InboxGateway] })
      class InboxModule {}

      const { url } = await start([InboxModule], { authenticate: () => ({ userId: 7 }) });
      const tabA = await connect(`${url}/inbox`);
      const tabB = await connect(`${url}/inbox`);

      assert.equal((await tabA.request('invite')).data, 'sent');
      assert.equal((await tabB.request('invite')).data.statusCode, 429);
      tabA.ws.close();
      tabB.ws.close();
    });

    it('en el gateway limita todos sus eventos', async () => {
      @Public()
      @Gateway('/limited')
      @RateLimit({ max: 1, windowMs: 60_000 })
      class LimitedGateway {
        @OnMessage('a', z.undefined())
        a() {
          return 'a';
        }

        @OnMessage('b', z.undefined())
        b() {
          return 'b';
        }
      }

      @Module({ providers: [LimitedGateway] })
      class LimitedModule {}

      const { url } = await start([LimitedModule]);
      const socket = await connect(`${url}/limited`);

      assert.equal((await socket.request('a')).data, 'a');
      assert.equal((await socket.request('b')).data.statusCode, 429);
      socket.ws.close();
    });

    it('el @RateLimit de HTTP en un gateway responde errors.internal en lugar de romper', async () => {
      @Public()
      @Gateway('/wrong')
      class WrongGateway {
        @OnMessage('x', z.undefined())
        @HttpRateLimit({ max: 1, windowMs: 60_000 })
        x() {
          return 'x';
        }
      }

      @Module({ providers: [WrongGateway] })
      class WrongModule {}

      const { url } = await start([WrongModule]);
      const socket = await connect(`${url}/wrong`);

      assert.equal((await socket.request('x')).data.code, 'errors.internal');
      socket.ws.close();
    });
  });

  describe('idioma por conexión', () => {
    const i18n = new I18n({
      defaultLocale: 'es',
      catalogs: {
        es: { greet: 'Hola {name}' },
        en: { greet: 'Hello {name}' },
      },
    });

    const Greet = z.object({ name: z.string() });

    @Public()
    @Gateway('/greet')
    class GreetGateway {
      @OnMessage('greet', Greet)
      greet({ client, data }: WsContext<typeof Greet>) {
        return { text: i18n.t('greet', { name: data.name }), locale: client.locale };
      }
    }

    @Module({ providers: [GreetGateway] })
    class GreetModule {}

    it('usa el Accept-Language del handshake en cada mensaje', async () => {
      const { url } = await start([GreetModule], { i18n });
      const english = await connect(`${url}/greet`, { 'accept-language': 'en-US,en;q=0.9' });
      const spanish = await connect(`${url}/greet`, { 'accept-language': 'es-CO' });
      const other = await connect(`${url}/greet`, { 'accept-language': 'fr' });

      assert.deepEqual((await english.request('greet', { name: 'Ana' })).data, {
        text: 'Hello Ana',
        locale: 'en',
      });
      assert.equal((await spanish.request('greet', { name: 'Ana' })).data.text, 'Hola Ana');
      assert.equal((await other.request('greet', { name: 'Ana' })).data.locale, 'es');
      for (const socket of [english, spanish, other]) socket.ws.close();
    });

    it('resolveLocale tiene prioridad sobre Accept-Language', async () => {
      const { url } = await start([GreetModule], {
        i18n,
        resolveLocale: (req) => new URL(req.url ?? '/', 'http://localhost').searchParams.get('lang'),
      });
      const socket = await connect(`${url}/greet?lang=en`, { 'accept-language': 'es' });
      const invalid = await connect(`${url}/greet?lang=<script>`, { 'accept-language': 'en' });

      assert.equal((await socket.request('greet', { name: 'Ana' })).data.locale, 'en');
      assert.equal((await invalid.request('greet', { name: 'Ana' })).data.locale, 'en');
      socket.ws.close();
      invalid.ws.close();
    });

    it('traduce los mensajes de error con el idioma de la conexión', async () => {
      const { url } = await start([GreetModule], { i18n });
      const socket = await connect(`${url}/greet`, { 'accept-language': 'es' });

      const reply = await socket.request('nope');

      assert.equal(reply.data.code, 'errors.notFound');
      assert.equal(reply.data.message, 'El recurso solicitado no existe');
      socket.ws.close();
    });

    it('sin i18n, client.locale es undefined', async () => {
      const { url } = await start([GreetModule]);
      const socket = await connect(`${url}/greet`, { 'accept-language': 'en' });

      const reply = await socket.request('greet', { name: 'Ana' });

      assert.equal(reply.data.locale, undefined);
      assert.equal(reply.data.text, 'Hola Ana');
      socket.ws.close();
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

    it('limita las salas por cliente con maxRoomsPerClient', async () => {
      const { url } = await start([ChatModule], { maxRoomsPerClient: 2 });
      const socket = await connect(`${url}/chat`);

      await socket.request('join', { room: 'a' });
      await socket.request('join', { room: 'b' });
      assert.equal((await socket.request('join', { room: 'a' })).data, 2);

      const rejected = await socket.request('join', { room: 'c' });
      assert.equal(rejected.event, 'error');
      assert.equal(rejected.data.statusCode, 400);
      assert.equal(rejected.data.code, 'errors.tooManyRooms');
      assert.equal(rejected.data.message, 'You can be in at most 2 rooms at a time');

      await socket.request('leave', { room: 'a' });
      assert.equal((await socket.request('join', { room: 'c' })).data, 2);
      socket.ws.close();
    });

    it('rechaza opciones numéricas que no son enteros positivos', () => {
      assert.throws(
        () => WebSocketModule.forRoot({ maxRoomsPerClient: 0 }),
        /maxRoomsPerClient must be a positive integer, received 0/
      );
      assert.throws(
        () => WebSocketModule.forRoot({ handshakeTimeoutMs: 1.5 }),
        /handshakeTimeoutMs must be a positive integer, received 1.5/
      );
      assert.throws(
        () => WebSocketModule.forRoot({ maxConnections: -1 }),
        /maxConnections must be a positive integer, received -1/
      );
      assert.throws(
        () => WebSocketModule.forRoot({ maxPendingHandshakes: 0 }),
        /maxPendingHandshakes must be a positive integer, received 0/
      );
      assert.throws(
        () => WebSocketModule.forRoot({ connectionsPerKey: { max: 0 } }),
        /connectionsPerKey\.max must be a positive integer, received 0/
      );
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

  describe('conexiones muertas o lentas', () => {
    const waitFor = async (condition: () => boolean, timeoutMs = 2_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error('la condición no se cumplió a tiempo');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    it('el heartbeat desconecta al cliente que no responde al ping y mantiene al que sí', { timeout: 5_000 }, async () => {
      const { url } = await start([EchoModule], { heartbeatMs: 30 });
      const silent = new WebSocket(`${url}/echo`, { autoPong: false });
      await once(silent, 'open');
      const healthy = await connect(`${url}/echo`);

      const [code] = (await once(silent, 'close')) as [number];

      assert.equal(code, 1006);
      assert.equal(healthy.ws.readyState, WebSocket.OPEN);
      healthy.ws.close();
    });

    it('desconecta al cliente que no lee sus mensajes al superar maxBufferedBytes', { timeout: 5_000 }, async () => {
      @Public()
      @Gateway('/flood')
      class FloodGateway {
        @OnMessage('flood', z.undefined())
        flood({ client }: WsContext) {
          const chunk = 'x'.repeat(64 * 1024);
          for (let i = 0; i < 400; i++) client.send('chunk', chunk);
        }
      }

      @Module({ providers: [FloodGateway] })
      class FloodModule {}

      const { app, url } = await start([FloodModule], { maxBufferedBytes: 64 * 1024 });
      const socket = await connect(`${url}/flood`);
      const server = app.get(WsServer);
      (socket.ws as unknown as { _socket: { pause(): void } })._socket.pause();

      socket.send({ event: 'flood' });
      await waitFor(() => server.clients.size === 0);

      assert.equal(server.clients.size, 0);
      socket.ws.terminate();
    });
  });

  describe('casos de error y variantes de configuración', () => {
    const capture = () => {
      const errors: unknown[] = [];
      return { errors, logger: { ...silentLogger, error: (_message: string, error?: unknown) => errors.push(error) } };
    };

    it('broadcast envía a todos los clientes salvo al excluido', async () => {
      @Public()
      @Gateway('/news')
      class NewsGateway {
        private readonly server = inject(WsServer);

        @OnMessage('publish', z.string())
        publish({ client, data }: WsContext<z.ZodString>) {
          this.server.broadcast('news', data, { except: client });
        }
      }

      @Module({ providers: [NewsGateway] })
      class NewsModule {}

      const { url } = await start([NewsModule]);
      const [author, reader] = await Promise.all([connect(`${url}/news`), connect(`${url}/news`)]);

      author.send({ event: 'publish', data: 'hola a todos' });

      assert.deepEqual(await reader.next(), { event: 'news', data: 'hola a todos' });
      author.ws.close();
      reader.ws.close();
    });

    it('si onConnection lanza un 4xx cierra con 1008 sin registrarlo, y con otro error cierra con 1011 y lo registra', async () => {
      @Gateway('/strict')
      class StrictGateway implements OnWsConnection {
        onConnection(client: WsClient) {
          if (client.state.kind === 'forbidden') throw new ForbiddenException();
          throw new Error('fallo interno');
        }
      }

      @Module({ providers: [StrictGateway] })
      class StrictModule {}

      const { errors, logger } = capture();
      let kind = 'forbidden';
      const { url } = await start(
        [StrictModule],
        { requireValidation: false, authenticate: () => ({ kind }) },
        { logger }
      );

      const forbidden = new WebSocket(`${url}/strict`);
      const [forbiddenCode] = (await once(forbidden, 'close')) as [number];
      kind = 'broken';
      const broken = new WebSocket(`${url}/strict`);
      const [brokenCode] = (await once(broken, 'close')) as [number];

      assert.equal(forbiddenCode, 1008);
      assert.equal(brokenCode, 1011);
      assert.equal(errors.length, 1);
      assert.equal((errors[0] as Error).message, 'fallo interno');
    });

    it('registra el error si onDisconnect falla', async () => {
      @Public()
      @Gateway('/leaving')
      class LeavingGateway implements OnWsDisconnect {
        onDisconnect() {
          throw new Error('no pude limpiar');
        }
      }

      @Module({ providers: [LeavingGateway] })
      class LeavingModule {}

      const { errors, logger } = capture();
      const { url } = await start([LeavingModule], { requireValidation: false }, { logger });
      const socket = await connect(`${url}/leaving`);

      socket.ws.close();
      await once(socket.ws, 'close');
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal((errors[0] as Error).message, 'no pude limpiar');
    });

    it('allowedOrigins acepta una función', async () => {
      const { url } = await start([EchoModule], {
        allowedOrigins: (origin) => new URL(origin).hostname.endsWith('.example.com'),
      });

      assert.equal(await handshakeStatus(`${url}/echo`, { origin: 'https://example.com.evil.io' }), 403);
      const allowed = await connect(`${url}/echo`, { origin: 'https://app.example.com' });
      allowed.ws.close();
    });

    it('resolveLocale acepta el nombre de una cabecera', async () => {
      const i18n = new I18n({ defaultLocale: 'es', catalogs: { es: {}, en: {} } });

      @Public()
      @Gateway('/lang')
      class LangGateway {
        @OnMessage('locale', z.undefined())
        locale({ client }: WsContext) {
          return client.locale;
        }
      }

      @Module({ providers: [LangGateway] })
      class LangModule {}

      const { url } = await start([LangModule], { i18n, resolveLocale: 'X-Lang' });
      const socket = await connect(`${url}/lang`, { 'x-lang': 'en', 'accept-language': 'es' });

      assert.equal((await socket.request('locale')).data, 'en');
      socket.ws.close();
    });

    it('no arranca si un gateway maneja el mismo evento dos veces', async () => {
      @Public()
      @Gateway('/twice')
      class TwiceGateway {
        @OnMessage('ping', z.undefined())
        first() {}

        @OnMessage('ping', z.undefined())
        second() {}
      }

      @Module({ providers: [TwiceGateway] })
      class TwiceModule {}

      await assert.rejects(start([TwiceModule]), /TwiceGateway handles the event "ping" more than once/);
    });

    it('avisa si hay gateways privados sin authenticate y lista los públicos', async () => {
      @Gateway('/private-only')
      class PrivateOnlyGateway {}

      @Module({ providers: [PrivateOnlyGateway] })
      class PrivateOnlyModule {}

      const warnings: string[] = [];
      const debug: string[] = [];
      await start(
        [EchoModule, PrivateOnlyModule],
        {},
        {
          logger: {
            ...silentLogger,
            warn: (message) => warnings.push(message),
            debug: (message) => debug.push(message),
          },
        }
      );

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /the 1 private gateways will reject every handshake with 401/);
      assert.deepEqual(debug, ['[WebSocket] Public gateways: /echo']);
    });

    it('rechaza un messageRateLimit inválido', () => {
      assert.throws(
        () => WebSocketModule.forRoot({ messageRateLimit: { max: 0, windowMs: 1000 } }),
        /max and windowMs must be positive integers/
      );
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
