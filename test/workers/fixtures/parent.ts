import { Module, createApp, silentLogger } from '../../../src/index.ts';
import { WorkersModule } from '../../../src/workers/index.ts';

@Module({
  imports: [
    WorkersModule.forRoot({
      entry: new URL('./worker.ts', import.meta.url),
      keys: [process.env.VIGA_TEST_KEY ?? 'orphan'],
      execArgv: ['--import', 'tsx', '--import', './test/setup.ts'],
    }),
  ],
})
class ParentModule {}

await createApp({ rootModule: ParentModule, logger: silentLogger }).init();
process.send?.('ready');
