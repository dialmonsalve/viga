import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { styleText } from 'node:util';

export class CliError extends Error {}

export type Color = 'green' | 'blue';

function findPackage(root: string, name: string) {
  let directory = resolve(root);
  for (;;) {
    const manifest = join(directory, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return manifest;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function findBin(root: string, name: string, bin: string) {
  const manifest = findPackage(root, name);
  if (!manifest) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  const bins = typeof parsed === 'object' && parsed !== null && 'bin' in parsed ? parsed.bin : undefined;
  const path = typeof bins === 'string' ? bins : typeof bins === 'object' && bins !== null && bin in bins ? (bins as Record<string, unknown>)[bin] : undefined;
  return typeof path === 'string' ? join(dirname(manifest), path) : undefined;
}

export function envFileFlags(root: string, file: string) {
  return existsSync(resolve(root, file)) ? [`--env-file-if-exists=${file}`] : [];
}

export function childEnv(): NodeJS.ProcessEnv {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  if (process.stdout.isTTY && FORCE_COLOR === undefined && NO_COLOR === undefined) {
    return { ...process.env, FORCE_COLOR: '1' };
  }
  return process.env;
}

export function usesColor() {
  const { FORCE_COLOR } = childEnv();
  return FORCE_COLOR !== undefined && FORCE_COLOR !== '0';
}

export function labelFor(name: string, color: Color, width: number) {
  return styleText(color, `[${name}]`.padEnd(width + 2), { stream: process.stdout });
}

export function prefixLines(child: ChildProcess, label: string) {
  for (const [source, target] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ] as const) {
    if (!source) continue;
    createInterface({ input: source, crlfDelay: Infinity }).on('line', (line) => target.write(`${label} ${line}\n`));
  }
}

export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) return code;
  return signal ? 128 + constants.signals[signal] : 1;
}

export function relaySignals(child: ChildProcess, onSignal: () => void = () => {}) {
  const relay = (signal: NodeJS.Signals) => {
    onSignal();
    if (signal !== 'SIGINT' || !process.stdin.isTTY) child.kill(signal);
  };
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, relay);
  return () => {
    for (const signal of signals) process.off(signal, relay);
  };
}
