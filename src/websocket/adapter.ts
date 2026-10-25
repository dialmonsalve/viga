import type { IncomingMessage, Server } from 'node:http';

export interface WsConnection {
  readonly bufferedAmount: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  onMessage(listener: (message: string, isBinary: boolean) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
}

export type WsVerdict =
  | { action: 'accept' }
  | { action: 'reject'; status: number }
  | { action: 'ignore'; status?: number };

export interface WsAdapterOptions {
  paths: readonly string[];
  maxPayload: number;
  heartbeatMs: number;
  verify(req: IncomingMessage): Promise<WsVerdict>;
  onConnection(connection: WsConnection, req: IncomingMessage): void;
}

export interface WsAdapter {
  attach(server: Server, options: WsAdapterOptions): void | Promise<void>;
  close(): void | Promise<void>;
}
