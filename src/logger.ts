import { styleText } from 'node:util';
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

type Level = keyof Logger;

export interface ConsoleLoggerOptions {
  console?: Pick<Console, Level>;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

const COLORS = { info: 'cyan', warn: 'yellow', error: 'red', debug: 'gray' } as const;
const AREA = /^\[[^\]\s]+\]/;

function paint(level: Level, message: string, stream: NodeJS.WritableStream) {
  if (level === 'debug') return styleText(COLORS.debug, message, { stream });
  const area = AREA.exec(message)?.[0];
  if (!area) return message;
  return styleText(COLORS[level], area, { stream }) + message.slice(area.length);
}

export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const target = () => options.console ?? console;
  const stdout = () => options.stdout ?? process.stdout;
  const stderr = () => options.stderr ?? process.stderr;

  return {
    info: (message, ...meta) => target().info(paint('info', message, stdout()), ...meta),
    warn: (message, ...meta) => target().warn(paint('warn', message, stderr()), ...meta),
    error: (message, ...meta) => target().error(paint('error', message, stderr()), ...meta),
    debug: (message, ...meta) => target().debug(paint('debug', message, stdout()), ...meta),
  };
}

export const consoleLogger = createConsoleLogger();
