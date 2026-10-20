import { toDecimal, Decimal } from './money.js';

export const CYCLE_DAYS = 30;
export const MS_DAY = 24 * 60 * 60 * 1000;
export const MONTHLY_MIN_PCT = 10;
export const MONTHLY_MAX_PCT = 12;

// 0.333334 × 30 = 10.00002% — clears the 10% floor (0.333333 yields 9.99999%)
export const DEFAULT_MIN_DAILY_PCT = '0.333334';
export const DEFAULT_MAX_DAILY_PCT = '0.4';

// Round daily ROI DOWN to 2 decimals so the aggregate never exceeds the cap
export function floorMoney(d) {
  return toDecimal(d).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

export function toUtcDate(dateInput) {
  if (dateInput instanceof Date) {
    return new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  }
  const [y, m, d] = String(dateInput).split('T')[0].split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// 30-day cycle per investment: cycle i = [startedAt + i*30d, startedAt + (i+1)*30d)
export function cycleFor(startedAt, roiDate) {
  const start = toUtcDate(startedAt);
  const date = toUtcDate(roiDate);
  const diffDays = Math.floor((date - start) / MS_DAY);
  if (diffDays < 0) return null;
  const index = Math.floor(diffDays / CYCLE_DAYS);
  const cycleStart = new Date(start.getTime() + index * CYCLE_DAYS * MS_DAY);
  const cycleEnd = new Date(cycleStart.getTime() + CYCLE_DAYS * MS_DAY);
  const daysElapsed = diffDays - index * CYCLE_DAYS;
  const remainingDays = Math.max(0, CYCLE_DAYS - daysElapsed); // includes roiDate
  return { index, cycleStart, cycleEnd, daysElapsed, remainingDays };
}

// Payouts may only be credited inside the daily window (default 6–8 PM local)
export function isPayoutWindowOpen(now = new Date()) {
  const start = Number(process.env.ROI_PAYOUT_START_HOUR ?? 18);
  const end = Number(process.env.ROI_PAYOUT_END_HOUR ?? 20);
  const h = now.getHours();
  return h >= start && h < end;
}

// Weekends carry no ROI
export function isWeekend(dateInput) {
  const d = toUtcDate(dateInput).getUTCDay();
  return d === 0 || d === 6;
}

// Count working days (Mon–Fri) in [from, to) — inclusive of `from`
export function workdaysBetween(from, to) {
  const start = toUtcDate(from);
  const end = toUtcDate(to);
  let count = 0;
  for (let t = start.getTime(); t < end.getTime(); t += MS_DAY) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// Simple interest on eligible principal — never on paid ROI
export function dailyRoiFor(principal, ratePercent) {
  return floorMoney(toDecimal(principal).mul(ratePercent).div(100));
}

export function cycleTargets(principal, cumulativePaid) {
  const p = toDecimal(principal);
  const cumulative = toDecimal(cumulativePaid);
  const minimumTarget = p.mul(MONTHLY_MIN_PCT).div(100);
  const maximumTarget = p.mul(MONTHLY_MAX_PCT).div(100);
  const clampZero = (d) => (d.gt(0) ? d : toDecimal(0));
  return {
    minimumTarget,
    maximumTarget,
    remainingToMinimum: clampZero(minimumTarget.sub(cumulative)),
    remainingBeforeCap: clampZero(maximumTarget.sub(cumulative)),
  };
}
