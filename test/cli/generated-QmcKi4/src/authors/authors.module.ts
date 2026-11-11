import { Module } from '../../../../../src/index.ts';
import { AuthorsController } from './authors.controller.ts';
import { AuthorsService } from './authors.service.ts';

@Module({
  controllers: [AuthorsController],
  providers: [AuthorsService],
})
export class AuthorsModule {}
