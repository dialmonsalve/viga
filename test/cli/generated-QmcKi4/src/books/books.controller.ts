import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from '../../../../../src/index.ts';
import { Validate } from '../../../../../src/validation/index.ts';
import { CreateBook, BookParams, UpdateBook } from './books.schemas.ts';
import { BooksService } from './books.service.ts';

@Controller('/books')
export class BooksController {
  private readonly books = inject(BooksService);

  @Get()
  findAll() {
    return this.books.findAll();
  }

  @Get('/:id')
  @Validate({ params: BookParams })
  findOne({ params }: HttpContext<{ params: typeof BookParams }>) {
    return this.books.findOne(params.id);
  }

  @Post()
  @Validate({ body: CreateBook })
  create({ body }: HttpContext<{ body: typeof CreateBook }>) {
    return this.books.create(body);
  }

  @Patch('/:id')
  @Validate({ params: BookParams, body: UpdateBook })
  update({ params, body }: HttpContext<{ params: typeof BookParams; body: typeof UpdateBook }>) {
    return this.books.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: BookParams })
  remove({ params }: HttpContext<{ params: typeof BookParams }>) {
    this.books.remove(params.id);
  }
}
