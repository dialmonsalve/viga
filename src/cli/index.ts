#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  controllerTemplate,
  moduleTemplate,
  namesOf,
  resourceControllerTemplate,
  resourceServiceTemplate,
  schemasTemplate,
  serviceTemplate,
  type SchemaLibrary,
} from './templates.ts';

const USAGE = `Usage: viga generate <kind> <name> [--path src] [--schema zod|valibot]

<name> can include folders: admin/books goes in <path>/admin/books/.

Kinds:
  resource    A module, a controller with CRUD routes, a service and its schemas
  module      A module
  controller  A controller
  service     A service

"g" is an alias of "generate". Files go in <path>/<name>/, and existing files are never changed.
`;

const NAME_FORMAT = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KINDS = ['resource', 'module', 'controller', 'service'];

class CliError extends Error {}

function detectSchema(root: string): SchemaLibrary {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) throw new CliError('No package.json here; run this from the root of your project');

  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  const dependencies =
    typeof parsed === 'object' && parsed !== null && 'dependencies' in parsed ? parsed.dependencies : undefined;
  const installed = typeof dependencies === 'object' && dependencies !== null ? dependencies : {};

  if ('zod' in installed) return 'zod';
  if ('valibot' in installed) return 'valibot';
  throw new CliError('A resource validates its input: install zod or valibot, or pass --schema');
}

function filesFor(kind: string, name: string, schema: () => SchemaLibrary) {
  const names = namesOf(name);
  const path = (suffix: string) => `${name}.${suffix}.ts`;

  switch (kind) {
    case 'resource':
      return {
        [path('module')]: moduleTemplate(names, { controller: true, service: true, file: name }),
        [path('controller')]: resourceControllerTemplate(names),
        [path('service')]: resourceServiceTemplate(names),
        [path('schemas')]: schemasTemplate(names, schema()),
      };
    case 'module':
      return { [path('module')]: moduleTemplate(names, { controller: false, service: false, file: name }) };
    case 'controller':
      return { [path('controller')]: controllerTemplate(names) };
    default:
      return { [path('service')]: serviceTemplate(names) };
  }
}

function nextStep(kind: string, name: string, directory: string, sourceRoot: string) {
  const { plural } = namesOf(name);
  const moduleFile = join(directory, `${name}.module.ts`);

  switch (kind) {
    case 'resource':
      return [
        `Add ${plural}Module to the imports of ${join(sourceRoot, 'app.module.ts')}.`,
        'Its routes are private by default: add @Public() to open one, or set up app.useAuthGuard().',
        'The service keeps its data in memory: replace it with your database when you are ready.',
      ];
    case 'module':
      return [`Add ${plural}Module to the imports of ${join(sourceRoot, 'app.module.ts')}.`];
    case 'controller':
      return [`Add ${plural}Controller to the controllers of ${moduleFile}, or of the module it belongs to.`];
    default:
      return [`Add ${plural}Service to the providers of ${moduleFile}, or of the module it belongs to.`];
  }
}

function generate(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      path: { type: 'string', default: 'src' },
      schema: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  const [command, kind, fullName, ...rest] = positionals;
  if (command !== 'generate' && command !== 'g') throw new CliError(`Unknown command "${command}"\n\n${USAGE}`);
  if (!kind || !KINDS.includes(kind) || !fullName || rest.length > 0) throw new CliError(USAGE);

  const segments = fullName.split('/');
  const name = segments.pop() ?? '';
  if (![...segments, name].every((segment) => NAME_FORMAT.test(segment))) {
    throw new CliError(
      `"${fullName}" is not a valid name: use lowercase letters, numbers and "-", like books, order-items or admin/books`
    );
  }

  const { schema } = values;
  if (schema !== undefined && schema !== 'zod' && schema !== 'valibot') {
    throw new CliError(`--schema must be zod or valibot, received ${schema}`);
  }

  const root = process.cwd();
  const sourceRoot = values.path;
  const fromRoot = relative(root, resolve(root, sourceRoot));
  if (isAbsolute(sourceRoot) || fromRoot.startsWith('..')) throw new CliError('--path must be inside your project');

  const directory = join(sourceRoot, ...segments, name);
  const files = filesFor(kind, name, () => schema ?? detectSchema(root));
  const paths = Object.keys(files).map((file) => join(directory, file));

  const existing = paths.filter((path) => existsSync(resolve(root, path)));
  if (existing.length > 0) {
    throw new CliError(`Nothing was created, because these files already exist:\n  ${existing.join('\n  ')}`);
  }

  for (const [file, content] of Object.entries(files)) {
    const target = resolve(root, directory, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
    console.log(`created ${join(directory, file)}`);
  }

  console.log(`\n${nextStep(kind, name, directory, sourceRoot).join('\n')}`);
}

try {
  generate(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
