import type { AnyConstructor, App } from '../../src/index.ts';
import {
  createTestingApp,
  type TestingAppOptions,
  type TestingRequestOptions,
  type TestingResponse,
} from '../../src/testing/index.ts';

export type TestResponse<T = any> = TestingResponse<T>;

export interface TestServer {
  app: App;
  url(path: string): string;
  request<T = any>(path: string, options?: TestingRequestOptions): Promise<TestResponse<T>>;
  close(): Promise<void>;
}

const allowAll = () => true;

export async function startTestServer(
  RootModule: AnyConstructor,
  { configure = (app) => app.useAuthGuard(allowAll), ...options }: TestingAppOptions = {}
): Promise<TestServer> {
  const testing = await createTestingApp(RootModule, { ...options, configure });
  return {
    app: testing.app,
    url: testing.url,
    request: (path, requestOptions) => testing.request(path, requestOptions),
    close: testing.close,
  };
}
