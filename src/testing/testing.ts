import type { AddressInfo } from 'node:net';
import { App, TESTING_OVERRIDES, createApp, type AppOptions } from '../app.ts';
import type { Provider, Token } from '../di/injector.ts';
import { silentLogger } from '../logger.ts';
import type { AnyConstructor } from '../metadata.ts';

export interface TestingAppOptions extends Omit<AppOptions, 'rootModule'> {
  overrides?: Provider[];
  configure?: (app: App) => void;
}

export interface TestingRequestOptions {
  method?: string;
  json?: unknown;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

export interface TestingResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface TestingApp {
  readonly app: App;
  url(path: string): string;
  request<T = unknown>(path: string, options?: TestingRequestOptions): Promise<TestingResponse<T>>;
  get<T>(token: Token<T>): T;
  close(): Promise<void>;
}

export async function createTestingApp(
  rootModule: AnyConstructor,
  { overrides = [], configure, ...options }: TestingAppOptions = {}
): Promise<TestingApp> {
  const app = createApp({ logger: silentLogger, ...options, rootModule });
  app[TESTING_OVERRIDES] = overrides;
  configure?.(app);

  let server;
  try {
    server = await app.listen(0, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    url: (path) => `${baseUrl}${path}`,
    async request<T>(path: string, { method = 'GET', json, body, headers = {} }: TestingRequestOptions = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: json === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body ?? (json === undefined ? undefined : JSON.stringify(json)),
      });
      const text = await response.text();
      const isJson = response.headers.get('content-type')?.includes('application/json') && text !== '';
      return {
        status: response.status,
        body: (isJson ? JSON.parse(text) : text) as T,
        headers: response.headers,
      };
    },
    get: (token) => app.get(token),
    close: () => app.close(),
  };
}
