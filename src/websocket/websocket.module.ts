import { Module } from '../decorators/module.ts';
import { WEBSOCKET_OPTIONS, resolveOptions, type WebSocketOptions } from './options.ts';
import { WsServer } from './server.ts';

export class WebSocketModule {
  static forRoot(options: WebSocketOptions | (() => WebSocketOptions) = {}) {
    const provider =
      typeof options === 'function'
        ? { provide: WEBSOCKET_OPTIONS, useFactory: () => resolveOptions(options()) }
        : { provide: WEBSOCKET_OPTIONS, useValue: resolveOptions(options) };

    @Module({
      global: true,
      providers: [provider, WsServer],
      exports: [WsServer],
    })
    class WebSocketRootModule {}

    return WebSocketRootModule;
  }
}
