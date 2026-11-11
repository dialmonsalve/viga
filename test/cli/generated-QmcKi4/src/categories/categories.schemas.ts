import { z } from 'zod';

export const CreateCategory = z.strictObject({
  name: z.string().min(1),
});

export const UpdateCategory = CreateCategory.partial();

export const CategoryParams = z.object({
  id: z.coerce.number().int().positive(),
});
