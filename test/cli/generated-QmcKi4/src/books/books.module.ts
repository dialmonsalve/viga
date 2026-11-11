import { Module } from '../../../../../src/index.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
