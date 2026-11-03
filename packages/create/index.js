#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const MIN_NODE = [24, 13];
const NAME_FORMAT = /^[a-z0-9][a-z0-9._-]{0,213}$/;

const VERSIONS = {
  viga: 'npm:@vigajs/core@^0.1.2',
  express: '^5.1.0',
  zod: '^4.0.0',
  valibot: '^1.5.0',
  typescript: '^7.0.0',
  tsx: '^4.23.0',
  '@types/express': '^5.0.0',
  '@types/node': '^24.0.0',
};

const SCHEMAS = ['zod', 'valibot', 'none'];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function packageManager() {
  const agent = process.env.npm_config_user_agent ?? '';
  const [name = 'npm', version = ''] = agent.split(' ')[0]?.split('/') ?? [];
  return { name: ['pnpm', 'yarn', 'bun', 'npm'].includes(name) ? name : 'npm', major: Number(version.split('.')[0]) };
}

function pickVersions(names) {
  return Object.fromEntries(names.sort().map((name) => [name, VERSIONS[name]]));
}

function projectFiles(name, schema, manager) {
  const dependencies = ['viga', 'express', ...(schema === 'none' ? [] : [schema])];
  const packageJson = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch src/main.ts',
      build: 'tsc',
      start: 'node dist/main.js',
    },
    dependencies: pickVersions(dependencies),
    devDependencies: pickVersions(['typescript', 'tsx', '@types/express', '@types/node']),
  };

  const files = {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify({ extends: 'viga/tsconfig.json', include: ['src'] }, null, 2)}\n`,
    '.gitignore': 'node_modules\ndist\n.env\n',
    'src/main.ts': `import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule }).enableShutdownHooks();

await app.listen();
`,
    'src/app.module.ts': `import { Module } from 'viga';
import { HelloModule } from './hello/hello.module.ts';

@Module({
  imports: [HelloModule],
})
export class AppModule {}
`,
    'src/hello/hello.module.ts': `import { Module } from 'viga';
import { HelloController } from './hello.controller.ts';
import { HelloService } from './hello.service.ts';

@Module({
  controllers: [HelloController],
  providers: [HelloService],
})
export class HelloModule {}
`,
    'src/hello/hello.controller.ts': `import { Controller, Get, Public, inject } from 'viga';
import { HelloService } from './hello.service.ts';

@Controller('/hello')
export class HelloController {
  private readonly hello = inject(HelloService);

  @Public()
  @Get()
  greet() {
    return this.hello.greet();
  }
}
`,
    'src/hello/hello.service.ts': `import { Injectable } from 'viga';

@Injectable()
export class HelloService {
  greet() {
    return { message: 'Hello from viga' };
  }
}
`,
  };

  if (manager.name === 'pnpm') {
    files['pnpm-workspace.yaml'] = 'allowBuilds:\n  esbuild: true\n';
  }
  if (manager.name === 'yarn' && manager.major >= 2) {
    files['.yarnrc.yml'] = 'nodeLinker: node-modules\n';
  }
  return files;
}

function nextSteps(directory, manager) {
  const run = manager.name === 'npm' ? 'npm run dev' : `${manager.name} dev`;
  return ['', 'Next steps:', '', `  cd ${directory}`, `  ${manager.name} install`, `  ${run}`, '', 'Then open http://localhost:3000/hello', ''].join('\n');
}

function main() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(`viga needs Node.js ${MIN_NODE.join('.')} or later, and this is ${process.versions.node}`);
  }

  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { schema: { type: 'string', default: 'zod' } },
    });
  } catch (error) {
    fail(error.message);
  }

  const [directory] = parsed.positionals;
  if (!directory || parsed.positionals.length > 1) {
    fail('usage: pnpm create @vigajs <directory> [--schema zod|valibot|none]');
  }

  const { schema } = parsed.values;
  if (!SCHEMAS.includes(schema)) fail(`--schema must be one of ${SCHEMAS.join(', ')}, received ${schema}`);

  const target = resolve(directory);
  const name = basename(target);
  if (!NAME_FORMAT.test(name)) {
    fail(`"${name}" is not a valid package name: use lowercase letters, numbers, ".", "_" and "-"`);
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    fail(`${directory} already exists and is not empty`);
  }

  const manager = packageManager();
  for (const [path, content] of Object.entries(projectFiles(name, schema, manager))) {
    const file = join(target, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  console.log(`Created ${name} in ${target}`);
  console.log(nextSteps(directory, manager));
}

main();
