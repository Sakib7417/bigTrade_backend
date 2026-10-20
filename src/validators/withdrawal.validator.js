import { z } from 'zod';

const bankDetailsSchema = z.object({
  bankName: z.string().min(1, 'Bank name is required'),
  accountNumber: z.string().min(1, 'Account number is required'),
  accountName: z.string().min(1, 'Account name is required'),
});

const bscAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a valid BSC wallet address (0x…)');

export const createWithdrawalSchema = z.object({
  amount: z.number().min(10, 'Minimum withdrawal is $10'),
  destinationAddress: bscAddress,
  bankDetails: bankDetailsSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const createPrincipalWithdrawalSchema = z.object({
  investmentId: z.string().min(1, 'Investment ID is required'),
  destinationAddress: bscAddress,
  bankDetails: bankDetailsSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const approveWithdrawalSchema = z.object({
  remarks: z.string().optional(),
});

export const rejectWithdrawalSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
});

export const completeWithdrawalSchema = z.object({
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash')
    .optional(),
});
