import { z } from 'zod';

export const CreateOrderItem = z.strictObject({
  name: z.string().min(1),
});

export const UpdateOrderItem = CreateOrderItem.partial();

export const OrderItemParams = z.object({
  id: z.coerce.number().int().positive(),
});
