import { Module } from '../../../../../src/index.ts';
import { SecretsController } from './secrets.controller.ts';
import { SecretsService } from './secrets.service.ts';

@Module({
  controllers: [SecretsController],
  providers: [SecretsService],
})
export class SecretsModule {}
