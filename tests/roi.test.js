import { calculateRoiAmount, applyEarningCap, percentOf, getCurrentPeriod } from '../src/utils/roi.js';
import { toDecimal } from '../src/utils/money.js';

describe('ROI calculation', () => {
  test('8% of $1000 = $80', () => {
    expect(calculateRoiAmount(1000, 8).toString()).toBe('80');
  });

  test('8% of $100 = $8', () => {
    expect(calculateRoiAmount(100, 8).toString()).toBe('8');
  });

  test('7.5% of $200 = $15', () => {
    expect(calculateRoiAmount(200, 7.5).toString()).toBe('15');
  });

  test('no floating point error on odd amounts', () => {
    // 333.33 * 6% = 19.9998 -> 20.00
    expect(calculateRoiAmount(333.33, 6).toString()).toBe('20');
  });
});

describe('5x earning cap', () => {
  test('full amount credited when under cap', () => {
    const r = applyEarningCap(80, 100, 500);
    expect(r.eligible).toBe(true);
    expect(r.creditable.toString()).toBe('80');
    expect(r.capped).toBe(false);
  });

  test('partial credit when cap nearly reached', () => {
    // earned 490 of 500, ROI = 20 -> only 10 creditable
    const r = applyEarningCap(20, 490, 500);
    expect(r.eligible).toBe(true);
    expect(r.creditable.toString()).toBe('10');
    expect(r.capped).toBe(true);
  });

  test('nothing credited once cap reached', () => {
    const r = applyEarningCap(20, 500, 500);
    expect(r.eligible).toBe(false);
    expect(r.creditable.toString()).toBe('0');
    expect(r.capped).toBe(true);
  });

  test('$100 investment cap is $500', () => {
    const cap = toDecimal(100).mul(5);
    const r = applyEarningCap(60, 440, cap);
    expect(r.creditable.toString()).toBe('60');
    expect(r.capped).toBe(true);
  });
});

describe('percentOf', () => {
  test('5% of $100 = $5 (direct commission)', () => {
    expect(percentOf(100, 5).toString()).toBe('5');
  });

  test('20% of $10 = $2 (level 1 commission)', () => {
    expect(percentOf(10, 20).toString()).toBe('2');
  });

  test('5% withdrawal fee on $100 = $5', () => {
    expect(percentOf(100, 5).toString()).toBe('5');
  });

  test('10% early principal penalty on $1000 = $100', () => {
    expect(percentOf(1000, 10).toString()).toBe('100');
  });
});

describe('getCurrentPeriod', () => {
  test('returns YYYY-MM', () => {
    expect(getCurrentPeriod(new Date('2026-10-15'))).toBe('2026-10');
  });
});
