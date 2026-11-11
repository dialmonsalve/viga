import { Module } from '../../../../../src/index.ts';
import { OrderItemsController } from './order-items.controller.ts';
import { OrderItemsService } from './order-items.service.ts';

@Module({
  controllers: [OrderItemsController],
  providers: [OrderItemsService],
})
export class OrderItemsModule {}
