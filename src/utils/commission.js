import { prisma } from '../config/database.js';
import { toDecimal } from './money.js';

// Default 20-level commission table (percentages of downline ROI income)
export const DEFAULT_LEVEL_PERCENTS = {
  1: 20,
  2: 10,
  3: 7.5,
  4: 5,
  5: 2.5,
  6: 1,
  7: 1,
  8: 1,
  9: 1,
  10: 1,
  11: 0.5,
  12: 0.5,
  13: 0.5,
  14: 0.5,
  15: 0.5,
  16: 0.5,
  17: 0.5,
  18: 0.5,
  19: 0.5,
  20: 0.5,
};

// Level unlock depends ONLY on the promoter's OWN active directs:
// L1–L5 need 2/4/6/8/10 directs (+2 each level), L6–L20 need 11..25 (+1 each).
export const requiredDirectsForLevel = (level) => (level <= 5 ? level * 2 : level + 5);

// An "active direct" = account ACTIVE + holds at least one live investment
// (ACTIVE or CAPPED — money still inside the platform). A direct that only
// registered, withdrew everything (COMPLETED) or dropped below the minimum
// (INACTIVE) does not count toward rank/level requirements.
export const LIVE_INVESTMENT_STATUSES = ['ACTIVE', 'CAPPED'];

export const countActiveDirects = async (parentId, db = prisma) =>
  db.user.count({
    where: {
      referredById: parentId,
      status: 'ACTIVE',
      investments: { some: { status: { in: LIVE_INVESTMENT_STATUSES } } },
    },
  });

// Load configured level percents from DB, falling back to defaults
export const getLevelPercents = async (db = prisma) => {
  const rows = await db.commissionLevel.findMany({ orderBy: { level: 'asc' } });
  const map = {};
  for (const row of rows) {
    map[row.level] = toDecimal(row.percent);
  }
  return Object.keys(map).length ? map : DEFAULT_LEVEL_PERCENTS;
};

export const getLevelPercent = async (level, db = prisma) => {
  const row = await db.commissionLevel.findUnique({ where: { level } });
  if (row) return toDecimal(row.percent);
  return DEFAULT_LEVEL_PERCENTS[level] !== undefined
    ? toDecimal(DEFAULT_LEVEL_PERCENTS[level])
    : null;
};

// Members-per-depth breakdown of a user's referral tree (display only —
// unlocks are driven by the promoter's own direct count, not this tree).
export const levelQualificationTree = async (userId, db = prisma) => {
  const depths = [];
  let frontier = [userId];

  for (let depth = 0; depth <= 20 && frontier.length; depth++) {
    const children = await db.user.findMany({
      where: { referredById: { in: frontier } },
      select: { id: true },
    });

    depths.push({ depth, members: frontier.length });

    frontier = children.map((c) => c.id);
  }

  return depths;
};

// Deepest income level (1..20) unlocked for a user — driven solely by the
// user's own active-direct count against requiredDirectsForLevel.
export const maxUnlockedLevel = async (userId, db = prisma) => {
  const directs = await countActiveDirects(userId, db);
  let unlocked = 0;
  while (unlocked < 20 && directs >= requiredDirectsForLevel(unlocked + 1)) {
    unlocked += 1;
  }
  return unlocked;
};
