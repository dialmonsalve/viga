import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CliError, envFileFlags, exitCodeOf, relaySignals } from './process.ts';

export const START_USAGE = `Usage: viga start [--entry dist/main.js] [--env-file .env] [-- <node options>]

Runs the built app with Node.js and loads the .env file if it exists.
Node.js options go after --, as in: viga start -- --enable-source-maps
`;

export function start(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      entry: { type: 'string', default: 'dist/main.js' },
      'env-file': { type: 'string', default: '.env' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(START_USAGE);
    return Promise.resolve(0);
  }

  const root = process.cwd();
  const { entry } = values;
  if (!existsSync(resolve(root, entry))) {
    throw new CliError(`${entry} does not exist; build the app first, or pass the file with --entry`);
  }

  const child = spawn(process.execPath, [...envFileFlags(root, values['env-file']), ...positionals, entry], {
    cwd: root,
    stdio: 'inherit',
  });
  const release = relaySignals(child);

  return new Promise<number>((done) => {
    child.on('error', (error) => {
      release();
      console.error(error.message);
      done(1);
    });
    child.on('exit', (code, signal) => {
      release();
      done(exitCodeOf(code, signal));
    });
  });
}
