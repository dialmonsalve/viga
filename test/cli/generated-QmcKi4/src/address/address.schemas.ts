import { z } from 'zod';

export const CreateAddress = z.strictObject({
  name: z.string().min(1),
});

export const UpdateAddress = CreateAddress.partial();

export const AddressParams = z.object({
  id: z.coerce.number().int().positive(),
});
