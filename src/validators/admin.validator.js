import { z } from 'zod';

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  mobile: z.string().min(10).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  mobile: z.string().min(10, 'Mobile number must be at least 10 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ADMIN', 'USER']).optional(),
  referralCode: z.string().optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
});

export const updateInvestmentStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'CAPPED', 'COMPLETED', 'CANCELLED']),
  remarks: z.string().optional(),
});

export const walletAdjustmentSchema = z.object({
  amount: z.number().refine((v) => v !== 0, 'Amount must not be zero'),
  reason: z.string().min(1, 'Reason is required'),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const updateSystemSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});
