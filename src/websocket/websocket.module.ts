import { Module } from '../decorators/module.ts';
import { WEBSOCKET_OPTIONS, resolveOptions, type WebSocketOptions } from './options.ts';
import { WsServer } from './server.ts';

export class WebSocketModule {
  static forRoot(options: WebSocketOptions = {}) {
    @Module({
      global: true,
      providers: [{ provide: WEBSOCKET_OPTIONS, useValue: resolveOptions(options) }, WsServer],
      exports: [WsServer],
    })
    class WebSocketRootModule {}

    return WebSocketRootModule;
  }
}
