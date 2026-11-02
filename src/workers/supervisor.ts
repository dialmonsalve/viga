import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Injectable } from '../decorators/injectable.ts';
import { InjectionToken, inject } from '../di/injector.ts';
import type { OnDrain, OnModuleInit } from '../di/lifecycle.ts';
import { diagnostic } from '../diagnostics.ts';
import { LOGGER } from '../logger.ts';
import { assertWorkerKey } from './worker-key.ts';

export interface WorkersOptions {
  entry: string | URL;
  keys?: readonly string[] | (() => readonly string[] | Promise<readonly string[]>);
  maxWorkers?: number;
  stopTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execArgv?: readonly string[];
}

export const WORKERS_OPTIONS = new InjectionToken<WorkersOptions>('WORKERS_OPTIONS');

export interface WorkerStatus {
  key: string;
  status: 'running' | 'restarting' | 'stopping';
  pid: number | undefined;
  restarts: number;
}

interface RunningWorker {
  key: string;
  child?: ChildProcess;
  startedAt: number;
  attempts: number;
  restarts: number;
  restartTimer?: NodeJS.Timeout;
  stopping?: Promise<void>;
  exited?: () => void;
}

const DEFAULT_MAX_WORKERS = 8;
const DEFAULT_STOP_TIMEOUT_MS = 30_000;
const FIRST_RESTART_DELAY_MS = 1_000;
const MAX_RESTART_DELAY_MS = 30_000;
const STABLE_AFTER_MS = 60_000;
const SWAPPED_EXTENSION: Record<string, string> = { '.ts': '.js', '.js': '.ts' };

export function restartDelay(attempts: number) {
  return Math.min(FIRST_RESTART_DELAY_MS * 2 ** attempts, MAX_RESTART_DELAY_MS);
}

function resolveEntry(entry: string | URL) {
  const path = typeof entry === 'string' ? entry : fileURLToPath(entry);
  if (existsSync(path)) return path;

  const swapped = SWAPPED_EXTENSION[path.slice(-3)];
  const alternative = swapped && `${path.slice(0, -3)}${swapped}`;
  if (alternative && existsSync(alternative)) return alternative;

  throw new Error(diagnostic('workers.entryNotFound', { entry: path }));
}

function inheritedExecArgv() {
  return process.execArgv.filter((arg) => !/^--(inspect|watch)/.test(arg));
}

@Injectable()
export class WorkerSupervisor implements OnModuleInit, OnDrain {
  private readonly logger = inject(LOGGER);
  private readonly options = inject(WORKERS_OPTIONS);
  private readonly maxWorkers = this.options.maxWorkers ?? DEFAULT_MAX_WORKERS;
  private readonly stopTimeoutMs = this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  private readonly entry = resolveEntry(this.options.entry);
  private readonly workers = new Map<string, RunningWorker>();
  private closing = false;

  constructor() {
    const valid = (value: number) => Number.isInteger(value) && value > 0;
    if (!valid(this.maxWorkers) || !valid(this.stopTimeoutMs)) {
      throw new Error(
        diagnostic('workers.invalidOptions', {
          maxWorkers: this.maxWorkers,
          stopTimeoutMs: this.stopTimeoutMs,
        })
      );
    }
  }

  async onModuleInit() {
    const { keys = [] } = this.options;
    const initial = new Set(typeof keys === 'function' ? await keys() : keys);

    for (const key of initial) assertWorkerKey(key);
    if (initial.size > this.maxWorkers) {
      const [key = ''] = [...initial].slice(this.maxWorkers);
      throw new Error(diagnostic('workers.limitReached', { key, maxWorkers: this.maxWorkers }));
    }

    await Promise.all([...initial].map((key) => this.start(key)));
  }

  async start(key: string): Promise<void> {
    assertWorkerKey(key);
    if (this.closing) throw new Error(diagnostic('workers.closing', { key }));

    const existing = this.workers.get(key);
    if (existing?.stopping) await existing.stopping;
    else if (existing) return;

    if (this.workers.has(key)) return;
    if (this.workers.size >= this.maxWorkers) {
      throw new Error(diagnostic('workers.limitReached', { key, maxWorkers: this.maxWorkers }));
    }

    const worker: RunningWorker = { key, startedAt: 0, attempts: 0, restarts: 0 };
    this.workers.set(key, worker);
    this.spawn(worker);
  }

  stop(key: string): Promise<void> {
    const worker = this.workers.get(key);
    if (!worker) return Promise.resolve();

    worker.stopping ??= this.terminate(worker);
    return worker.stopping;
  }

  list(): WorkerStatus[] {
    return [...this.workers.values()].map((worker) => ({
      key: worker.key,
      status: worker.stopping ? 'stopping' : worker.restartTimer ? 'restarting' : 'running',
      pid: worker.child?.pid,
      restarts: worker.restarts,
    }));
  }

  async onDrain() {
    this.closing = true;
    await Promise.all([...this.workers.keys()].map((key) => this.stop(key)));
  }

  private spawn(worker: RunningWorker) {
    const child = fork(this.entry, [worker.key], {
      execArgv: [...(this.options.execArgv ?? inheritedExecArgv())],
      env: this.options.env ?? process.env,
    });

    worker.child = child;
    worker.startedAt = Date.now();
    child.on('error', (error) => this.logger.error(diagnostic('workers.spawnFailed', { key: worker.key }), error));
    child.once('close', (code, signal) => this.onExit(worker, code, signal));
  }

  private onExit(worker: RunningWorker, code: number | null, signal: NodeJS.Signals | null) {
    worker.child = undefined;

    if (worker.stopping) {
      this.workers.delete(worker.key);
      worker.exited?.();
      return;
    }

    if (code === 0) {
      this.workers.delete(worker.key);
      this.logger.info(diagnostic('workers.finished', { key: worker.key }));
      return;
    }

    if (Date.now() - worker.startedAt >= STABLE_AFTER_MS) worker.attempts = 0;
    const delayMs = restartDelay(worker.attempts);
    worker.attempts++;
    worker.restarts++;

    this.logger.error(
      diagnostic('workers.crashed', { key: worker.key, reason: signal ?? `code ${code}`, delayMs })
    );
    worker.restartTimer = setTimeout(() => {
      worker.restartTimer = undefined;
      this.spawn(worker);
    }, delayMs);
    worker.restartTimer.unref();
  }

  private async terminate(worker: RunningWorker) {
    clearTimeout(worker.restartTimer);
    worker.restartTimer = undefined;

    const { child } = worker;
    if (!child) {
      this.workers.delete(worker.key);
      return;
    }

    const exited = new Promise<void>((resolve) => {
      worker.exited = resolve;
    });
    const killTimer = setTimeout(() => {
      this.logger.warn(
        diagnostic('workers.killed', { key: worker.key, stopTimeoutMs: this.stopTimeoutMs })
      );
      child.kill('SIGKILL');
    }, this.stopTimeoutMs);

    child.kill('SIGTERM');
    await exited;
    clearTimeout(killTimer);
  }
}
