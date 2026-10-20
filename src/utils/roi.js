import { toDecimal, roundMoney } from './money.js';

// Current ROI period in "YYYY-MM" format
export const getCurrentPeriod = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Monthly ROI = principal * roiPercent / 100, rounded to currency precision
export const calculateRoiAmount = (amount, roiPercent) => {
  return roundMoney(toDecimal(amount).mul(toDecimal(roiPercent)).div(100));
};

// Cap helper: returns the portion of `amount` still creditable under the cap
export const applyEarningCap = (amount, totalEarned, earningCap) => {
  const earned = toDecimal(totalEarned);
  const cap = toDecimal(earningCap);
  const remaining = cap.sub(earned);

  if (remaining.lte(0)) {
    return { eligible: false, creditable: toDecimal(0), capped: true, remaining };
  }

  const requested = toDecimal(amount);
  const creditable = requested.lte(remaining) ? requested : remaining;

  return {
    eligible: true,
    creditable,
    // capped when this credit brings total earned to the cap
    capped: earned.add(creditable).gte(cap),
    remaining,
  };
};

// Percentage helper for commissions/fees
export const percentOf = (amount, percent) => {
  return roundMoney(toDecimal(amount).mul(toDecimal(percent)).div(100));
};
