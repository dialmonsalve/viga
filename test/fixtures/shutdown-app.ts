import { Injectable, Module, createApp, silentLogger, type OnModuleDestroy } from '../../src/index.ts';

const failOnDestroy = process.argv.includes('--fail-on-destroy');

@Injectable()
class Pool implements OnModuleDestroy {
  onModuleDestroy() {
    process.stdout.write('destroyed\n');
    if (failOnDestroy) throw new Error('no cierra');
  }
}

@Module({ providers: [Pool] })
class AppModule {}

setInterval(() => undefined, 60_000);

const app = createApp({ rootModule: AppModule, logger: silentLogger }).enableShutdownHooks();
await app.listen(0, '127.0.0.1');
process.stdout.write('ready\n');
