import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from '../../../../../src/index.ts';
import { Validate } from '../../../../../src/validation/index.ts';
import { CreateAuthor, AuthorParams, UpdateAuthor } from './authors.schemas.ts';
import { AuthorsService } from './authors.service.ts';

@Controller('/authors')
export class AuthorsController {
  private readonly authors = inject(AuthorsService);

  @Get()
  findAll() {
    return this.authors.findAll();
  }

  @Get('/:id')
  @Validate({ params: AuthorParams })
  findOne({ params }: HttpContext<{ params: typeof AuthorParams }>) {
    return this.authors.findOne(params.id);
  }

  @Post()
  @Validate({ body: CreateAuthor })
  create({ body }: HttpContext<{ body: typeof CreateAuthor }>) {
    return this.authors.create(body);
  }

  @Patch('/:id')
  @Validate({ params: AuthorParams, body: UpdateAuthor })
  update({ params, body }: HttpContext<{ params: typeof AuthorParams; body: typeof UpdateAuthor }>) {
    return this.authors.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: AuthorParams })
  remove({ params }: HttpContext<{ params: typeof AuthorParams }>) {
    this.authors.remove(params.id);
  }
}
