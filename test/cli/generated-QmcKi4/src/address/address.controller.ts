import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from 'viga';
import { Validate } from 'viga/validation';
import { CreateAddress, AddressParams, UpdateAddress } from './address.schemas.ts';
import { AddressService } from './address.service.ts';

@Controller('/address')
export class AddressController {
  private readonly address = inject(AddressService);

  @Get()
  findAll() {
    return this.address.findAll();
  }

  @Get('/:id')
  @Validate({ params: AddressParams })
  findOne({ params }: HttpContext<{ params: typeof AddressParams }>) {
    return this.address.findOne(params.id);
  }

  @Post()
  @Validate({ body: CreateAddress })
  create({ body }: HttpContext<{ body: typeof CreateAddress }>) {
    return this.address.create(body);
  }

  @Patch('/:id')
  @Validate({ params: AddressParams, body: UpdateAddress })
  update({ params, body }: HttpContext<{ params: typeof AddressParams; body: typeof UpdateAddress }>) {
    return this.address.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: AddressParams })
  remove({ params }: HttpContext<{ params: typeof AddressParams }>) {
    this.address.remove(params.id);
  }
}
