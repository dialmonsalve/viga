import { appendFileSync } from 'node:fs';
import { Injectable, Module, inject, silentLogger, type OnModuleDestroy, type OnModuleInit } from '../../../src/index.ts';
import { ConfigModule } from '../../../src/config/index.ts';
import { WORKER_KEY, startWorker } from '../../../src/workers/index.ts';

function record(line: string) {
  appendFileSync(process.env.VIGA_TEST_LOG ?? '/dev/null', `${line}\n`);
}

@Injectable()
class FixtureWorker implements OnModuleInit, OnModuleDestroy {
  private readonly key = inject(WORKER_KEY);
  private timer?: NodeJS.Timeout;

  async onModuleInit() {
    if (this.key === 'orphan-slow') await new Promise((resolve) => setTimeout(resolve, 400));
    record(`up ${this.key} ${process.pid}`);
    this.timer = setInterval(() => {}, 1_000);

    if (this.key === 'crash') setTimeout(() => process.exit(7), 20);
    if (this.key === 'done') setTimeout(() => process.exit(0), 20);
    if (this.key === 'failinit') throw new Error('init failed');
  }

  async onModuleDestroy() {
    if (this.key === 'stuck') await new Promise(() => {});
    clearInterval(this.timer);
    record(`destroyed ${this.key}`);
  }
}

@Module({ imports: [ConfigModule.forRoot({ schema: { '~standard': { version: 1, vendor: 'test', validate: () => ({ value: {} }) } } })], providers: [FixtureWorker] })
class FixtureModule {}

await startWorker(FixtureModule, { logger: silentLogger, orphanTimeoutMs: process.argv[2] === 'stuck' ? 200 : 30_000 });
