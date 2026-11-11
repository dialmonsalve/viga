import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from 'viga';
import { Validate } from 'viga/validation';
import { CreateCategory, CategoryParams, UpdateCategory } from './categories.schemas.ts';
import { CategoriesService } from './categories.service.ts';

@Controller('/categories')
export class CategoriesController {
  private readonly categories = inject(CategoriesService);

  @Get()
  findAll() {
    return this.categories.findAll();
  }

  @Get('/:id')
  @Validate({ params: CategoryParams })
  findOne({ params }: HttpContext<{ params: typeof CategoryParams }>) {
    return this.categories.findOne(params.id);
  }

  @Post()
  @Validate({ body: CreateCategory })
  create({ body }: HttpContext<{ body: typeof CreateCategory }>) {
    return this.categories.create(body);
  }

  @Patch('/:id')
  @Validate({ params: CategoryParams, body: UpdateCategory })
  update({ params, body }: HttpContext<{ params: typeof CategoryParams; body: typeof UpdateCategory }>) {
    return this.categories.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: CategoryParams })
  remove({ params }: HttpContext<{ params: typeof CategoryParams }>) {
    this.categories.remove(params.id);
  }
}
