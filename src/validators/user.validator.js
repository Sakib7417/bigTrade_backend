import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  mobile: z.string().min(10, 'Mobile number must be at least 10 digits').optional(),
});

export const setWithdrawalPasswordSchema = z.object({
  newPassword: z.string().min(6, 'Withdrawal password must be at least 6 characters').max(64),
  otp: z.string().min(4).max(10).optional(),
});
