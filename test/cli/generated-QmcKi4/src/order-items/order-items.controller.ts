import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from '../../../../../src/index.ts';
import { Validate } from '../../../../../src/validation/index.ts';
import { CreateOrderItem, OrderItemParams, UpdateOrderItem } from './order-items.schemas.ts';
import { OrderItemsService } from './order-items.service.ts';

@Controller('/order-items')
export class OrderItemsController {
  private readonly orderItems = inject(OrderItemsService);

  @Get()
  findAll() {
    return this.orderItems.findAll();
  }

  @Get('/:id')
  @Validate({ params: OrderItemParams })
  findOne({ params }: HttpContext<{ params: typeof OrderItemParams }>) {
    return this.orderItems.findOne(params.id);
  }

  @Post()
  @Validate({ body: CreateOrderItem })
  create({ body }: HttpContext<{ body: typeof CreateOrderItem }>) {
    return this.orderItems.create(body);
  }

  @Patch('/:id')
  @Validate({ params: OrderItemParams, body: UpdateOrderItem })
  update({ params, body }: HttpContext<{ params: typeof OrderItemParams; body: typeof UpdateOrderItem }>) {
    return this.orderItems.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: OrderItemParams })
  remove({ params }: HttpContext<{ params: typeof OrderItemParams }>) {
    this.orderItems.remove(params.id);
  }
}
