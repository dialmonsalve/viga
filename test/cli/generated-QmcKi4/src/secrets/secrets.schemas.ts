import { z } from 'zod';

export const CreateSecret = z.strictObject({
  name: z.string().min(1),
});

export const UpdateSecret = CreateSecret.partial();

export const SecretParams = z.object({
  id: z.coerce.number().int().positive(),
});
