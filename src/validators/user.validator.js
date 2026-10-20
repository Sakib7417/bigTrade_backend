import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  mobile: z.string().min(10, 'Mobile number must be at least 10 digits').optional(),
});
