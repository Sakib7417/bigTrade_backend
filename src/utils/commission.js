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

// Active directs a member at the given depth needs for the NEXT level to unlock.
// Depth 0 = the promoter (unlocks L1). Members at levels 1–5 need 2 directs;
// members at levels 6–20 need 1 direct. Level N is unlocked only when EVERY
// member at depths 0..N-1 satisfies this requirement (sequential rule).
export const requiredDirectsForMember = (depth) => (depth <= 5 ? 2 : 1);

// Display requirement shown on a level tile (what members at that level need).
export const requiredDirectsForLevel = (level) => (level <= 5 ? 2 : 1);

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

// Per-depth qualification breakdown of a user's referral tree.
// Returns one entry per depth (0 = promoter, 1..20 = level members).
export const levelQualificationTree = async (userId, db = prisma) => {
  const depths = [];
  let frontier = [userId];

  for (let depth = 0; depth <= 20 && frontier.length; depth++) {
    const required = requiredDirectsForMember(depth);
    const children = await db.user.findMany({
      where: { referredById: { in: frontier } },
      select: {
        id: true,
        referredById: true,
        status: true,
        investments: {
          where: { status: { in: LIVE_INVESTMENT_STATUSES } },
          select: { id: true },
          take: 1,
        },
      },
    });
    const counts = new Map();
    for (const c of children) {
      if (c.status === 'ACTIVE' && c.investments.length > 0) {
        counts.set(c.referredById, (counts.get(c.referredById) ?? 0) + 1);
      }
    }
    const qualified = frontier.filter((id) => (counts.get(id) ?? 0) >= required).length;

    depths.push({
      depth,
      required,
      members: frontier.length,
      qualified,
      unqualified: frontier.length - qualified,
      allQualified: qualified === frontier.length,
    });

    frontier = children.map((c) => c.id);
  }

  return depths;
};

// Deepest income level (1..20) unlocked for a user — 0 means locked at L1.
// Sequential: level N is unlocked only when every member at depths 0..N-1
// meets its direct-referral requirement.
export const maxUnlockedLevel = async (userId, db = prisma) => {
  const depths = await levelQualificationTree(userId, db);
  let unlocked = 0;
  for (const d of depths) {
    if (d.depth > 19 || !d.allQualified) break;
    unlocked = d.depth + 1;
  }
  return unlocked;
};
