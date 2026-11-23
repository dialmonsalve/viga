import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { normalize, resolve, sep } from 'node:path';
import { styleText } from 'node:util';
import {
  CliError,
  childEnv,
  envFileFlags,
  exitCodeOf,
  findBin,
  labelFor,
  parseCommand,
  prefixLines,
  relaySignals,
  usesColor,
} from './process.ts';

export const DEV_USAGE = `Usage: viga dev [--entry src/main.ts] [--env-file .env] [--strict | --no-check] [-- <node options>]

Runs the app with tsx, restarts it when a file in its folder changes and loads the .env file if it exists.
It also checks the types with tsc after every change; --no-check turns that off.
With --strict, the app only runs while tsc finds no errors: it waits for them to be fixed before starting,
and stops when a change introduces one.
Node.js options go after --, as in: viga dev -- --inspect
`;

const WATCHED = /\.(?:[cm]?tsx?|json)$/;
const IGNORED = /(?:^|[\\/])(?:node_modules|dist|\.git)(?:[\\/]|$)/;

function sourceDirectory(entry: string) {
  const [first, ...rest] = normalize(entry).split(sep);
  return rest.length > 0 && first ? first : '.';
}

function writer(label: string) {
  return (line: string, color?: 'green' | 'yellow') =>
    process.stdout.write(`${label} ${color ? styleText(color, line, { stream: process.stdout }) : line}\n`);
}

function warnAboutTsconfig(root: string, tsc: string, write: ReturnType<typeof writer>) {
  const result = spawnSync(process.execPath, [tsc, '--showConfig', '-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return;
  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const compilerOptions =
      typeof parsed === 'object' && parsed !== null && 'compilerOptions' in parsed ? parsed.compilerOptions : undefined;
    if (typeof compilerOptions === 'object' && compilerOptions !== null) options = compilerOptions as Record<string, unknown>;
  } catch {
    return;
  }
  if (options.experimentalDecorators === true) {
    write(
      'tsconfig.json turns on experimentalDecorators, so TypeScript uses legacy decorators and viga\'s stop working; remove it',
      'yellow'
    );
  }
  if (options.strict !== true) {
    write('tsconfig.json does not turn on strict, so many type errors go unnoticed; add "strict": true', 'yellow');
  }
}

interface TypeChecker {
  stop(): void;
}

function startTypeChecker(
  root: string,
  tsc: string,
  directory: string,
  write: ReturnType<typeof writer>,
  label: string,
  onResult: (ok: boolean) => void
): TypeChecker {
  let running: ChildProcess | undefined;
  let pending = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const run = () => {
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    const child = spawn(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json', '--pretty', String(usesColor())], {
      cwd: root,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running = child;
    prefixLines(child, label);
    child.on('close', (code) => {
      running = undefined;
      if (stopped) return;
      if (pending) {
        pending = false;
        run();
        return;
      }
      if (code === 0) write('No type errors', 'green');
      onResult(code === 0);
    });
  };

  const schedule = (file: string | undefined) => {
    if (!file || IGNORED.test(file) || !WATCHED.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  };

  const watchers: FSWatcher[] = [
    watch(resolve(root, directory), { recursive: true }, (_event, file) => schedule(file ?? undefined)),
    watch(root, (_event, file) => {
      if (file === 'tsconfig.json') schedule(file);
    }),
  ];

  run();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      running?.kill();
    },
  };
}

interface DevOptions {
  root: string;
  tsx: string;
  entry: string;
  directory: string;
  appArgs: string[];
  appLabel: string;
}

function runWatching(options: DevOptions, checker: (onResult: (ok: boolean) => void) => TypeChecker | undefined) {
  const { root, tsx, entry, directory, appArgs, appLabel } = options;
  const app = spawn(
    process.execPath,
    [tsx, 'watch', '--clear-screen=false', '--include', directory, ...appArgs, entry],
    { cwd: root, env: childEnv(), stdio: ['inherit', 'pipe', 'pipe'] }
  );
  prefixLines(app, appLabel);

  const types = checker(() => {});
  let interrupted = false;
  const release = relaySignals(app, () => {
    interrupted = true;
    types?.stop();
  });

  return new Promise<number>((done) => {
    app.on('error', (error) => {
      release();
      types?.stop();
      console.error(error.message);
      done(1);
    });
    app.on('close', (code, signal) => {
      release();
      types?.stop();
      done(interrupted ? 0 : exitCodeOf(code, signal));
    });
  });
}

function runStrict(options: DevOptions, checker: (onResult: (ok: boolean) => void) => TypeChecker | undefined) {
  const { root, tsx, entry, appArgs, appLabel } = options;
  const write = writer(appLabel);
  let app: ChildProcess | undefined;
  let closing: Promise<void> | undefined;
  let shuttingDown = false;

  const stopApp = () => {
    if (closing) return closing;
    if (!app) return Promise.resolve();
    const current = app;
    app = undefined;
    closing = new Promise<void>((done) => {
      current.once('close', () => {
        closing = undefined;
        done();
      });
      current.kill('SIGTERM');
    });
    return closing;
  };

  const startApp = () => {
    const child = spawn(process.execPath, [tsx, ...appArgs, entry], {
      cwd: root,
      env: childEnv(),
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    app = child;
    prefixLines(child, appLabel);
    child.on('close', (code, signal) => {
      if (app !== child || shuttingDown) return;
      app = undefined;
      write(`Exited with code ${exitCodeOf(code, signal)}; it starts again when you save a change without type errors`, 'yellow');
    });
  };

  return new Promise<number>((done) => {
    let types: TypeChecker | undefined;

    const shutDown = (signal: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      types?.stop();
      for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(name, shutDown);
      const current = app;
      if (!current) {
        done(0);
        return;
      }
      current.once('close', () => done(0));
      if (signal !== 'SIGINT' || !process.stdin.isTTY) current.kill(signal);
    };
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(name, shutDown);

    types = checker((ok) => {
      if (shuttingDown) return;
      if (!ok) {
        if (app) {
          void stopApp();
          write('Stopped until the type errors are fixed', 'yellow');
        } else {
          write('Waiting for the type errors to be fixed', 'yellow');
        }
        return;
      }
      void stopApp().then(() => {
        if (!shuttingDown) startApp();
      });
    });
  });
}

export function dev(argv: string[]) {
  const { values, positionals } = parseCommand('dev', {
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      entry: { type: 'string', default: 'src/main.ts' },
      'env-file': { type: 'string', default: '.env' },
      check: { type: 'boolean', default: true },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(DEV_USAGE);
    return Promise.resolve(0);
  }
  if (values.strict && !values.check) throw new CliError('--strict needs the type check, so it cannot be used with --no-check');

  const root = process.cwd();
  const { entry } = values;
  if (!existsSync(resolve(root, entry))) {
    throw new CliError(`${entry} does not exist; pass your entry file with --entry`);
  }

  const tsx = findBin(root, 'tsx', 'tsx');
  if (!tsx) throw new CliError('viga dev runs your app with tsx, which is not installed; add it with: pnpm add -D tsx');

  const tsc = values.check ? findBin(root, 'typescript', 'tsc') : undefined;
  const hasTsconfig = existsSync(resolve(root, 'tsconfig.json'));
  if (values.strict && !tsc) throw new CliError('--strict checks the types with tsc, which is not installed; add it with: pnpm add -D typescript');
  if (values.strict && !hasTsconfig) throw new CliError('--strict checks the types with your tsconfig.json, which does not exist');

  const directory = sourceDirectory(entry);
  const width = values.check ? 'types'.length : 'app'.length;
  const typesLabel = labelFor('types', 'blue', width);
  const writeTypes = writer(typesLabel);

  if (values.check && !tsc) writeTypes('TypeScript is not installed, so types are not checked; install typescript or pass --no-check');
  else if (values.check && !hasTsconfig) writeTypes('There is no tsconfig.json, so types are not checked');
  else if (tsc) warnAboutTsconfig(root, tsc, writeTypes);

  const checker = (onResult: (ok: boolean) => void) =>
    tsc && hasTsconfig ? startTypeChecker(root, tsc, directory, writeTypes, typesLabel, onResult) : undefined;

  const options: DevOptions = {
    root,
    tsx,
    entry,
    directory,
    appArgs: [...envFileFlags(root, values['env-file']), ...positionals],
    appLabel: labelFor('app', 'green', width),
  };

  return values.strict ? runStrict(options, checker) : runWatching(options, checker);
}
