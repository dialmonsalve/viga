import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from '../../../../../src/index.ts';
import { Validate } from '../../../../../src/validation/index.ts';
import { CreateSecret, SecretParams, UpdateSecret } from './secrets.schemas.ts';
import { SecretsService } from './secrets.service.ts';

@Controller('/secrets')
export class SecretsController {
  private readonly secrets = inject(SecretsService);

  @Get()
  findAll() {
    return this.secrets.findAll();
  }

  @Get('/:id')
  @Validate({ params: SecretParams })
  findOne({ params }: HttpContext<{ params: typeof SecretParams }>) {
    return this.secrets.findOne(params.id);
  }

  @Post()
  @Validate({ body: CreateSecret })
  create({ body }: HttpContext<{ body: typeof CreateSecret }>) {
    return this.secrets.create(body);
  }

  @Patch('/:id')
  @Validate({ params: SecretParams, body: UpdateSecret })
  update({ params, body }: HttpContext<{ params: typeof SecretParams; body: typeof UpdateSecret }>) {
    return this.secrets.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: SecretParams })
  remove({ params }: HttpContext<{ params: typeof SecretParams }>) {
    this.secrets.remove(params.id);
  }
}
