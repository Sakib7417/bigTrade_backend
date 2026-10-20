import { prisma } from '../config/database.js';
import { toDecimal } from './money.js';

// All income types counted toward the promoter cap:
// daily/monthly ROI, direct commission, level income, rank rewards
export const INCOME_TX_TYPES = ['ROI', 'DIRECT_COMMISSION', 'LEVEL_COMMISSION', 'RANK_REWARD'];

// Promoter capping: total income of every type combined may not exceed
// EARNING_CAP_MULTIPLIER (10x) of the user's invested amount.
// Returns { cap, totalEarned, remaining } as Decimals.
export async function earningCapInfo(userId, tx = prisma) {
  const [capSetting, inv, earned] = await Promise.all([
    tx.systemSetting.findUnique({ where: { key: 'EARNING_CAP_MULTIPLIER' } }),
    tx.investment.aggregate({
      where: { userId, status: { not: 'CANCELLED' } },
      _sum: { amount: true },
    }),
    tx.walletTransaction.aggregate({
      where: { userId, direction: 'CREDIT', type: { in: INCOME_TX_TYPES } },
      _sum: { amount: true },
    }),
  ]);

  const multiplier = toDecimal(capSetting?.value ?? '10');
  const cap = toDecimal(inv._sum.amount ?? 0).mul(multiplier);
  const totalEarned = toDecimal(earned._sum.amount ?? 0);
  const remaining = cap.sub(totalEarned);
  return { cap, totalEarned, remaining: remaining.gt(0) ? remaining : toDecimal(0) };
}

// Amount actually creditable under the global cap (0 = earning stopped)
export async function capIncome(userId, amount, tx = prisma) {
  const { remaining } = await earningCapInfo(userId, tx);
  const a = toDecimal(amount);
  return a.lte(remaining) ? a : remaining;
}
