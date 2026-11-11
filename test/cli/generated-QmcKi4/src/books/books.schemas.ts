import { z } from 'zod';

export const CreateBook = z.strictObject({
  name: z.string().min(1),
});

export const UpdateBook = CreateBook.partial();

export const BookParams = z.object({
  id: z.coerce.number().int().positive(),
});
