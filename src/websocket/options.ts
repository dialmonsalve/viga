import type { IncomingMessage } from 'node:http';
import { InjectionToken } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import type { MessageResolver } from '../http/messages.ts';
import type { WsAdapter } from './adapter.ts';
import { createWsAdapter } from './ws-adapter.ts';

export type WsAuthenticate = (
  req: IncomingMessage
) => boolean | Record<string, unknown> | Promise<boolean | Record<string, unknown>>;

export interface WsMessageRateLimit {
  max: number;
  windowMs: number;
}

export interface WebSocketOptions {
  adapter?: WsAdapter;
  authenticate?: WsAuthenticate;
  allowedOrigins?: readonly string[] | ((origin: string) => boolean);
  maxPayload?: number;
  maxBufferedBytes?: number;
  maxRoomsPerClient?: number;
  handshakeTimeoutMs?: number;
  heartbeatMs?: number;
  messageRateLimit?: WsMessageRateLimit | false;
  requireValidation?: boolean;
  resolveMessage?: MessageResolver;
}

export type ResolvedWebSocketOptions = Required<
  Omit<WebSocketOptions, 'authenticate' | 'resolveMessage'>
> &
  Pick<WebSocketOptions, 'authenticate' | 'resolveMessage'>;

export const WEBSOCKET_OPTIONS = new InjectionToken<ResolvedWebSocketOptions>('WEBSOCKET_OPTIONS');

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

export function resolveOptions(options: WebSocketOptions): ResolvedWebSocketOptions {
  const resolved: ResolvedWebSocketOptions = {
    adapter: createWsAdapter(),
    allowedOrigins: [],
    maxPayload: 100 * 1024,
    maxBufferedBytes: 1024 * 1024,
    maxRoomsPerClient: 100,
    handshakeTimeoutMs: 10_000,
    heartbeatMs: 30_000,
    messageRateLimit: { max: 100, windowMs: 10_000 },
    requireValidation: true,
    ...options,
  };

  for (const option of ['maxRoomsPerClient', 'handshakeTimeoutMs'] as const) {
    if (!isPositiveInteger(resolved[option])) {
      throw new Error(
        diagnostic('ws.invalidOption', { option, value: String(resolved[option]) })
      );
    }
  }

  const limit = resolved.messageRateLimit;
  if (limit && (!isPositiveInteger(limit.max) || !isPositiveInteger(limit.windowMs))) {
    throw new Error(
      diagnostic('rateLimit.invalidOptions', { max: limit.max, windowMs: limit.windowMs })
    );
  }
  return resolved;
}
