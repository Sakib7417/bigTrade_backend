import { z } from 'zod';

export const createInvestmentSchema = z.object({
  amount: z.number().min(100, 'Minimum investment is $100'),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const topUpInvestmentSchema = z.object({
  investmentId: z.string().min(1, 'Investment ID is required'),
  amount: z.number().min(100, 'Minimum top-up is $100'),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
