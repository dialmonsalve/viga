import { InjectionToken } from './di/injector.ts';

export interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}

export const LOGGER = new InjectionToken<Logger>('LOGGER');

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
