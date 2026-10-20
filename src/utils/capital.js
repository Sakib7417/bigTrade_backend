// Capital deduction schedule on principal withdrawal (from the official plan):
//   before 30 days   → 10%
//   up to 60 days    → 8%
//   up to 90 days    → 6%
//   up to 120 days   → 4%
//   up to 150 days   → 2%
//   after 150 days   → 0%
export const CAPITAL_DEDUCTION_BRACKETS = [
  { maxDays: 30, percent: 10 },
  { maxDays: 60, percent: 8 },
  { maxDays: 90, percent: 6 },
  { maxDays: 120, percent: 4 },
  { maxDays: 150, percent: 2 },
];

const MS_DAY = 24 * 60 * 60 * 1000;

export function capitalDeductionPercent(startedAt, now = new Date()) {
  const ageDays = Math.floor((now.getTime() - new Date(startedAt).getTime()) / MS_DAY);
  for (const b of CAPITAL_DEDUCTION_BRACKETS) {
    if (ageDays < b.maxDays) return b.percent;
  }
  return 0;
}
