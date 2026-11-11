import { Controller, Get } from 'viga';

@Controller('/shop')
export class ShopController {
  @Get()
  findAll() {
    return [];
  }
}
