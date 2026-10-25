import type { IncomingMessage } from 'node:http';
import { InjectionToken } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import type { MessageResolver } from '../http/messages.ts';
import type { I18n } from '../i18n/i18n.ts';
import type { WsAdapter } from './adapter.ts';
import { createWsAdapter } from './ws-adapter.ts';

export type WsAuthenticate = (
  req: IncomingMessage
) => boolean | Record<string, unknown> | Promise<boolean | Record<string, unknown>>;

export type WsLocaleResolver = (
  req: IncomingMessage
) => string | readonly string[] | null | undefined;

export interface WsConnectionsPerKey {
  max: number;
  key?: (req: IncomingMessage) => string | undefined;
}

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
  maxConnections?: number;
  connectionsPerKey?: WsConnectionsPerKey | false;
  heartbeatMs?: number;
  messageRateLimit?: WsMessageRateLimit | false;
  requireValidation?: boolean;
  resolveMessage?: MessageResolver;
  i18n?: I18n;
  resolveLocale?: string | WsLocaleResolver;
}

type OptionalKeys = 'authenticate' | 'resolveMessage' | 'i18n' | 'resolveLocale';

export type ResolvedWebSocketOptions = Required<Omit<WebSocketOptions, OptionalKeys>> &
  Pick<WebSocketOptions, OptionalKeys>;

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
    maxConnections: 10_000,
    connectionsPerKey: false,
    heartbeatMs: 30_000,
    messageRateLimit: { max: 100, windowMs: 10_000 },
    requireValidation: true,
    ...options,
    resolveMessage: options.resolveMessage ?? options.i18n?.resolveMessage,
  };

  for (const option of ['maxRoomsPerClient', 'handshakeTimeoutMs', 'maxConnections'] as const) {
    if (!isPositiveInteger(resolved[option])) {
      throw new Error(
        diagnostic('ws.invalidOption', { option, value: String(resolved[option]) })
      );
    }
  }

  const perKey = resolved.connectionsPerKey;
  if (perKey && !isPositiveInteger(perKey.max)) {
    throw new Error(
      diagnostic('ws.invalidOption', { option: 'connectionsPerKey.max', value: String(perKey.max) })
    );
  }

  const limit = resolved.messageRateLimit;
  if (limit && (!isPositiveInteger(limit.max) || !isPositiveInteger(limit.windowMs))) {
    throw new Error(
      diagnostic('rateLimit.invalidOptions', { max: limit.max, windowMs: limit.windowMs })
    );
  }
  return resolved;
}
