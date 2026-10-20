import { registerSchema, loginSchema } from '../src/validators/auth.validator.js';
import { createInvestmentSchema, topUpInvestmentSchema } from '../src/validators/investment.validator.js';
import { createWithdrawalSchema } from '../src/validators/withdrawal.validator.js';
import { setGlobalRoiSchema } from '../src/validators/roi.validator.js';

const validBank = { bankName: 'Test', accountNumber: '123', accountName: 'X' };

describe('Auth validation', () => {
  test('valid registration passes', () => {
    const r = registerSchema.safeParse({
      name: 'John',
      email: 'john@x.com',
      mobile: '1234567890',
      password: 'password123',
    });
    expect(r.success).toBe(true);
  });

  test('invalid email rejected', () => {
    const r = registerSchema.safeParse({
      name: 'John',
      email: 'not-an-email',
      mobile: '1234567890',
      password: 'password123',
    });
    expect(r.success).toBe(false);
  });

  test('short password rejected', () => {
    const r = registerSchema.safeParse({
      name: 'John',
      email: 'john@x.com',
      mobile: '1234567890',
      password: 'short',
    });
    expect(r.success).toBe(false);
  });

  test('login requires identifier and password', () => {
    expect(loginSchema.safeParse({ identifier: 'a@b.com' }).success).toBe(false);
  });
});

describe('Investment validation', () => {
  test('rejects amount below $100', () => {
    expect(createInvestmentSchema.safeParse({ amount: 50 }).success).toBe(false);
  });

  test('accepts $100', () => {
    expect(createInvestmentSchema.safeParse({ amount: 100 }).success).toBe(true);
  });

  test('top-up requires investmentId', () => {
    expect(topUpInvestmentSchema.safeParse({ amount: 100 }).success).toBe(false);
  });
});

describe('Withdrawal validation', () => {
  test('rejects amount below $10', () => {
    expect(
      createWithdrawalSchema.safeParse({ amount: 5, bankDetails: validBank }).success
    ).toBe(false);
  });

  test('requires bank details', () => {
    expect(createWithdrawalSchema.safeParse({ amount: 100 }).success).toBe(false);
  });
});

describe('ROI validation', () => {
  test('rejects ROI below 6%', () => {
    expect(setGlobalRoiSchema.safeParse({ roiPercent: 5, period: '2026-10' }).success).toBe(false);
  });

  test('rejects ROI above 12%', () => {
    expect(setGlobalRoiSchema.safeParse({ roiPercent: 13, period: '2026-10' }).success).toBe(false);
  });

  test('accepts 8% with valid period', () => {
    expect(setGlobalRoiSchema.safeParse({ roiPercent: 8, period: '2026-10' }).success).toBe(true);
  });

  test('rejects bad period format', () => {
    expect(setGlobalRoiSchema.safeParse({ roiPercent: 8, period: 'Oct-2026' }).success).toBe(false);
  });
});
