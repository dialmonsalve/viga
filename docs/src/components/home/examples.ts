export const examples = [
  {
    file: 'books.controller.ts',
    path: 'src/books/books.controller.ts',
    code: `import { Controller, Get, Post, Public, inject } from 'viga';
import type { HttpContext } from 'viga';
import { Validate } from 'viga/validation';
import { CreateBook } from './books.schemas.ts';
import { BooksService } from './books.service.ts';

@Controller('/books')
export class BooksController {
  private readonly books = inject(BooksService);

  @Public()
  @Get()
  list() {
    return this.books.findAll();
  }

  @Post()
  @Validate({ body: CreateBook })
  create({ body }: HttpContext<{ body: typeof CreateBook }>) {
    return this.books.create(body);
  }
}`,
  },
  {
    file: 'books.schemas.ts',
    path: 'src/books/books.schemas.ts',
    code: `import { z } from 'zod';

export const CreateBook = z.object({
  title: z.string().min(1),
  year: z.number().int(),
});`,
  },
  {
    file: 'books.module.ts',
    path: 'src/books/books.module.ts',
    code: `import { Module } from 'viga';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}`,
  },
  {
    file: 'main.ts',
    path: 'src/main.ts',
    code: `import { createApp } from 'viga';
import { BooksModule } from './books/books.module.ts';

const app = createApp({ rootModule: BooksModule });

app.enableShutdownHooks();
await app.listen();`,
  },
];
