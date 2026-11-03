---
title: viga/workers
description: Run background work with the same code inside the API, in child processes or on another server, with a supervisor that restarts crashed processes.
head:
  - tag: title
    content: 'Background workers in Node.js with viga/workers'
sidebar:
  order: 11
---

A worker is the part of your app that does background work, outside requests: importing a CSV, sending emails or generating reports. `viga/workers` lets you write it once and decide later where it runs. It also ships a supervisor that creates a process for each key, for example one per company, and restarts it if it crashes.

**It isn't a queue system.** viga doesn't store jobs, retry them or schedule them: for that, use a library like BullMQ or pg-boss. What `viga/workers` does is start, stop and watch the process where that library runs.

## Write the worker

A worker is a normal provider: it starts consuming jobs in `onModuleInit` and stops in `onModuleDestroy`. `WORKER_KEY` tells it which key it serves:

```ts title="src/imports/imports.worker.ts"
import { Injectable, inject, runInNewContext, type OnModuleDestroy, type OnModuleInit } from 'viga';
import { WORKER_KEY } from 'viga/workers';
import { Worker, type Job } from 'bullmq';

@Injectable()
export class ImportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly key = inject(WORKER_KEY);
  private readonly imports = inject(ImportsService);
  private queue?: Worker;

  onModuleInit() {
    this.queue = new Worker(`imports-${this.key}`, (job) => this.process(job), { connection });
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  private async process(job: Job) {
    return runInNewContext(() => this.imports.run(job.data));
  }
}
```

`runInNewContext` gives each job its own [context](../../core/request-lifecycle/#outside-a-request), as if it were a request, so one job doesn't see another's values.

Group it in its module, with no controllers or anything that depends on HTTP:

```ts title="src/imports/imports-worker.module.ts"
import { Module } from 'viga';

@Module({
  imports: [ImportsModule],
  providers: [ImportsWorker],
})
export class ImportsWorkerModule {}
```

## Choose where it runs

| Mode | Isolation | When to use it |
| --- | --- | --- |
| [Inside the API](#inside-the-api) | None: it shares a process with your routes. | Light input and output work, and development. |
| [Child processes](#child-processes) | A failure or high CPU use doesn't stop the API. | A single machine, or one process per company. |
| [Another server](#another-server) | It also isolates memory and the machine. | When you have to scale workers separately from the API. |

CPU-heavy work, like processing a CSV of 100,000 rows, needs at least a separate process. Node.js runs your code on a single thread: inside the API, every request would wait for it to finish.

### Inside the API

Import the module in the API, with the key it serves:

```ts title="src/app.module.ts"
import { WorkerModule } from 'viga/workers';

@Module({
  imports: [WorkerModule.forKey('emails'), ImportsWorkerModule],
})
export class AppModule {}
```

### Child processes

Create an entry file for the worker:

```ts title="src/worker.ts"
import { startWorker } from 'viga/workers';
import { ImportsWorkerModule } from './imports/imports-worker.module.ts';

await startWorker(ImportsWorkerModule);
```

And add the supervisor to the API:

```ts title="src/app.module.ts"
import { WorkersModule } from 'viga/workers';

WorkersModule.forRoot({
  entry: new URL('./worker.ts', import.meta.url),
  keys: ['imports', 'reports'],
}),
```

Write the path with `.ts`: if only `worker.js` exists after compiling, viga uses that one.

`ImportsWorkerModule` is the root of the child process, so import in it the [global modules](../../core/modules/#global-modules) it needs, like `ConfigModule`. The child process starts its own app, with its own providers and connections: it doesn't share memory with the API.

### Another server

The same entry file runs on its own, with the key as an argument:

```sh
node dist/worker.js emails
```

This is the right choice with Docker, systemd or Kubernetes, which already restart crashed processes, and `startWorker` responds to `SIGTERM` with an orderly shutdown:

```dockerfile
CMD ["node", "dist/worker.js", "emails"]
```

If you need one process per company on that server, use `WorkersModule` in an app that calls `init()` instead of `listen()`.

## One worker per company

If each company has its own queue, the list of keys comes from your database. Pass a function to `forRoot`, which can ask for providers of global modules with `inject()`:

```ts title="src/app.module.ts"
WorkersModule.forRoot(() => {
  const tenants = inject(TenantsService);

  return {
    entry: new URL('./worker.ts', import.meta.url),
    keys: () => tenants.slugs(),
    maxWorkers: 20,
  };
}),
```

With `WorkerSupervisor` you manage workers while the app is running, for example when registering a company:

```ts
import { WorkerSupervisor } from 'viga/workers';

private readonly workers = inject(WorkerSupervisor);

async createTenant(data: NewTenant) {
  const tenant = await this.tenants.create(data);
  await this.workers.start(tenant.slug);
  return tenant;
}
```

| Method | What it does |
| --- | --- |
| `start(key)` | Starts a worker. If it already exists, it does nothing. |
| `stop(key)` | Stops it and waits for it to finish. If it doesn't exist, it does nothing. |
| `list()` | Returns each worker's `key`, `status` (`running`, `restarting` or `stopping`), `pid` and `restarts`. |

The key reaches the worker as an argument and only accepts letters, numbers, `.`, `_`, `:` and `-`, so a valid slug works as is. Inside the worker, use `WORKER_KEY` to choose the queue and store the company in each job's context:

```ts
private async process(job: Job) {
  return runInNewContext(async () => {
    CURRENT_TENANT.set(await this.tenants.findBySlug(this.key));
    return this.imports.run(job.data);
  });
}
```

### How much memory it uses

Each worker is a Node.js process with its own copy of your app. An idle viga process, with no dependencies beyond viga itself, uses about 80 MiB of resident memory, and your dependencies and data add to that. Part of that memory is shared between processes, so the real cost is somewhat lower, but measure it in your app before deciding.

That's why `maxWorkers` is 8 by default, and exceeding it gives an error instead of exhausting the machine's memory. Raise it once you know your machine can hold them. If there are many companies and most are idle most of the time, a single shared queue with the company in each job uses far less.

CPU isolation has another limit: it only holds while there are fewer active workers than cores.

## When a worker fails

The supervisor restarts a worker that exits with an error, and logs each crash:

```txt
[Workers] The worker imports exited with code 1; restarting it in 1000 ms
```

The wait starts at 1 second and doubles on each crash up to 30 seconds, so a worker that fails on startup doesn't consume the machine. If it ran for at least 60 seconds, it goes back to 1 second. A worker that exits with code 0 is considered finished on purpose, and isn't restarted.

A restart doesn't recover the job in progress. That depends on your queue library, which normally delivers it again, so a job has to be repeatable without duplicate effects.

## On shutdown

When the app stops, the supervisor sends `SIGTERM` to each worker, which shuts down in an orderly way by running its `onModuleDestroy` hooks. This happens after in-flight requests finish.

If a worker doesn't finish within 30 seconds, the supervisor forces it to close with `SIGKILL` and logs it. Change it with `stopTimeoutMs`, according to how long your longest job takes, and keep it below the time your platform gives to finish. Otherwise, the platform stops the process first.

If the parent process dies suddenly, with no chance to warn, its workers detect it and close on their own, so no orphan processes remain. If that shutdown hangs, the worker exits by force after 30 seconds, or whatever you set in `startWorker(Module, { orphanTimeoutMs })`.

## Environment variables and arguments

A worker inherits the environment variables of the process that creates it, as well as its Node.js arguments. That's why it works the same with `node --import tsx` or `tsx` as with compiled code. The exceptions are `--inspect` and `--watch`: all the processes would compete for the same port, and `--watch` would restart each one on its own.

Both can be changed:

```ts
WorkersModule.forRoot({
  entry: new URL('./worker.ts', import.meta.url),
  env: { ...process.env, LOG_LEVEL: 'warn' },
  execArgv: ['--max-old-space-size=512'],
}),
```

If you use `process.loadEnvFile()` in `main.ts`, the children receive those variables. A worker that runs [on its own](#another-server) has to load them itself.

## In tests

Test the worker's logic without processes, providing the key with `WorkerModule.forKey`:

```ts title="test/imports.test.ts"
import { createTestingApp } from 'viga/testing';
import { WorkerModule } from 'viga/workers';

@Module({ imports: [WorkerModule.forKey('test'), ImportsWorkerModule] })
class TestModule {}

const app = await createTestingApp(TestModule, {
  overrides: [{ provide: ImportsService, useValue: fakeImports }],
});
```
