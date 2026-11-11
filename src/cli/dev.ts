import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { normalize, resolve, sep } from 'node:path';
import { parseArgs, styleText } from 'node:util';
import { CliError, childEnv, exitCodeOf, findBin, labelFor, prefixLines, relaySignals, usesColor } from './process.ts';

export const DEV_USAGE = `Usage: viga dev [--entry src/main.ts] [--env-file .env] [--no-check] [-- <node options>]

Runs the app with tsx, restarts it when a file in its folder changes and loads the .env file if it exists.
It also checks the types with tsc after every change; --no-check turns that off.
Node.js options go after --, as in: viga dev -- --inspect
`;

const WATCHED = /\.(?:[cm]?tsx?|json)$/;
const IGNORED = /(?:^|[\\/])(?:node_modules|dist|\.git)(?:[\\/]|$)/;

function sourceDirectory(entry: string) {
  const [first, ...rest] = normalize(entry).split(sep);
  return rest.length > 0 && first ? first : '.';
}

function startTypeChecker(root: string, directory: string, label: string) {
  const write = (line: string) => process.stdout.write(`${label} ${line}\n`);
  const tsc = findBin(root, 'typescript', 'tsc');
  if (!tsc) {
    write('TypeScript is not installed, so types are not checked; install typescript or pass --no-check');
    return () => {};
  }
  if (!existsSync(resolve(root, 'tsconfig.json'))) {
    write('There is no tsconfig.json, so types are not checked');
    return () => {};
  }

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
      if (code === 0) write(styleText('green', 'No type errors', { stream: process.stdout }));
      if (pending) {
        pending = false;
        run();
      }
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

  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    running?.kill();
  };
}

export function dev(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      entry: { type: 'string', default: 'src/main.ts' },
      'env-file': { type: 'string', default: '.env' },
      check: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(DEV_USAGE);
    return Promise.resolve(0);
  }

  const root = process.cwd();
  const { entry } = values;
  if (!existsSync(resolve(root, entry))) {
    throw new CliError(`${entry} does not exist; pass your entry file with --entry`);
  }

  const tsx = findBin(root, 'tsx', 'tsx');
  if (!tsx) throw new CliError('viga dev runs your app with tsx, which is not installed; add it with: pnpm add -D tsx');

  const directory = sourceDirectory(entry);
  const width = values.check ? 'types'.length : 'app'.length;
  const app = spawn(
    process.execPath,
    [tsx, 'watch', '--clear-screen=false', '--include', directory, `--env-file-if-exists=${values['env-file']}`, ...positionals, entry],
    { cwd: root, env: childEnv(), stdio: ['inherit', 'pipe', 'pipe'] }
  );
  prefixLines(app, labelFor('app', 'green', width));

  const stopChecker = values.check ? startTypeChecker(root, directory, labelFor('types', 'blue', width)) : () => {};
  const release = relaySignals(app, stopChecker);

  return new Promise<number>((done) => {
    app.on('error', (error) => {
      release();
      stopChecker();
      console.error(error.message);
      done(1);
    });
    app.on('close', (code, signal) => {
      release();
      stopChecker();
      done(exitCodeOf(code, signal));
    });
  });
}
