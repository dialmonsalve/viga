import { createApp, silentLogger, type App, type AnyConstructor, type AppOptions } from '../../src/index.ts';

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
}

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface TestServer {
  app: App;
  request<T = any>(path: string, options?: RequestOptions): Promise<TestResponse<T>>;
  close(): Promise<void>;
}

type TestAppOptions = Omit<AppOptions, 'rootModule'> & {
  configure?: (app: App) => void;
};

const allowAll = () => true;

export async function startTestServer(
  RootModule: AnyConstructor,
  { configure = (app) => app.useAuthGuard(allowAll), ...options }: TestAppOptions = {}
): Promise<TestServer> {
  const app = createApp({ rootModule: RootModule, logger: silentLogger, ...options });
  configure(app);

  const server = await app.listen(0, '127.0.0.1');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    async request(path, { method = 'GET', json, body, headers = {} } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: json === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body ?? (json === undefined ? undefined : JSON.stringify(json)),
      });
      const text = await response.text();
      const isJson = response.headers.get('content-type')?.includes('application/json');
      return {
        status: response.status,
        body: isJson ? JSON.parse(text) : text,
        headers: response.headers,
      };
    },
    close: () => app.close(),
  };
}
