import { jest } from '@jest/globals';
import {
  DEFAULT_LEVEL_PERCENTS,
  getLevelPercent,
  requiredDirectsForMember,
  requiredDirectsForLevel,
  maxUnlockedLevel,
  levelQualificationTree,
} from '../src/utils/commission.js';
import { percentOf } from '../src/utils/roi.js';
import { toDecimal } from '../src/utils/money.js';

// Mock prisma so getLevelPercent falls back to defaults when DB rows are absent
jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: {
    commissionLevel: {
      findUnique: jest.fn(async ({ where }) => {
        const p = DEFAULT_LEVEL_PERCENTS[where.level];
        return p !== undefined ? { level: where.level, percent: p } : null;
      }),
      findMany: jest.fn(async () =>
        Object.entries(DEFAULT_LEVEL_PERCENTS).map(([level, percent]) => ({
          level: Number(level),
          percent,
        }))
      ),
    },
  },
}));

describe('Level commission table', () => {
  test('level 1 = 20%', () => {
    expect(DEFAULT_LEVEL_PERCENTS[1]).toBe(20);
  });

  test('level 2 = 10%', () => {
    expect(DEFAULT_LEVEL_PERCENTS[2]).toBe(10);
  });

  test('level 3 = 7.5%', () => {
    expect(DEFAULT_LEVEL_PERCENTS[3]).toBe(7.5);
  });

  test('level 5 = 2.5%', () => {
    expect(DEFAULT_LEVEL_PERCENTS[5]).toBe(2.5);
  });

  test('level 10 = 1%', () => {
    expect(DEFAULT_LEVEL_PERCENTS[10]).toBe(1);
  });

  test('level 20 = 0.5%', () => {
    expect(DEFAULT_LEVEL_PERCENTS[20]).toBe(0.5);
  });

  test('level 21 is not configured - no commission', async () => {
    const p = await getLevelPercent(21);
    expect(p).toBeNull();
  });

  test('level payouts on $10 downline ROI', () => {
    // A gets L1=20%=$2, B-level2=10%=$1
    expect(percentOf(10, DEFAULT_LEVEL_PERCENTS[1]).toString()).toBe('2');
    expect(percentOf(10, DEFAULT_LEVEL_PERCENTS[2]).toString()).toBe('1');
    expect(percentOf(10, DEFAULT_LEVEL_PERCENTS[3]).toString()).toBe('0.75');
  });
});

// ---- Sequential level-qualification rules -----------------------------------
// Depth 0 = promoter. Members at levels 1–5 need 2 active directs; members at
// levels 6–20 need 1. Level N unlocks only when every member at depths 0..N-1
// qualifies.

// In-memory referral tree + fake db adapter matching the Prisma calls used
// by levelQualificationTree. `live` models "holds an ACTIVE/CAPPED investment"
// — only live members count as active directs.
function makeDb(users) {
  return {
    user: {
      findMany: async ({ where }) =>
        users
          .filter((u) => where.referredById.in.includes(u.referredById))
          .map((u) => ({
            id: u.id,
            referredById: u.referredById,
            status: u.status,
            investments: u.live === false ? [] : [{ id: `i-${u.id}` }],
          })),
    },
  };
}

const U = (id, parent, status = 'ACTIVE', live = true) => ({ id, referredById: parent, status, live });

describe('Level qualification requirements', () => {
  test('members at depths 0–5 need 2 active directs', () => {
    for (const d of [0, 1, 2, 3, 4, 5]) {
      expect(requiredDirectsForMember(d)).toBe(2);
    }
  });

  test('members at depths 6–19 need 1 active direct', () => {
    for (const d of [6, 7, 10, 15, 19]) {
      expect(requiredDirectsForMember(d)).toBe(1);
    }
  });

  test('display requirements: L1–5 = 2, L6–20 = 1', () => {
    expect(requiredDirectsForLevel(1)).toBe(2);
    expect(requiredDirectsForLevel(5)).toBe(2);
    expect(requiredDirectsForLevel(6)).toBe(1);
    expect(requiredDirectsForLevel(20)).toBe(1);
  });
});

describe('Sequential level unlocking', () => {
  test('promoter with fewer than 2 active directs unlocks nothing', async () => {
    const db = makeDb([U('u', null), U('a', 'u'), U('b', 'u', 'INACTIVE')]);
    expect(await maxUnlockedLevel('u', db)).toBe(0);
  });

  test('2 active directs unlock only L1 when directs have no team', async () => {
    const db = makeDb([U('u', null), U('a', 'u'), U('b', 'u')]);
    expect(await maxUnlockedLevel('u', db)).toBe(1);
  });

  test('L2 unlocks when every L1 member has 2 directs', async () => {
    const db = makeDb([
      U('u', null), U('a', 'u'), U('b', 'u'),
      U('a1', 'a'), U('a2', 'a'), U('b1', 'b'), U('b2', 'b'),
    ]);
    expect(await maxUnlockedLevel('u', db)).toBe(2);
  });

  test('one unqualified L1 member locks L2 and everything deeper', async () => {
    const db = makeDb([
      U('u', null), U('a', 'u'), U('b', 'u'),
      U('a1', 'a'), U('a2', 'a'), // b has 0 directs -> depth 1 not fully qualified
      U('a1c', 'a1'), U('a1d', 'a1'), // deeper members exist but must stay locked
    ]);
    expect(await maxUnlockedLevel('u', db)).toBe(1);
  });

  test('direct with no live investment does not count as active', async () => {
    const db = makeDb([
      U('u', null), U('a', 'u'), U('b', 'u', 'ACTIVE', false), // b withdrew everything
    ]);
    expect(await maxUnlockedLevel('u', db)).toBe(0);
  });

  test('inactive member still blocks: 2 directs but one inactive direct fails', async () => {
    const db = makeDb([
      U('u', null), U('a', 'u'), U('b', 'u'),
      U('a1', 'a'), U('a2', 'a'),
      U('b1', 'b'), U('b2', 'b', 'INACTIVE'), // b only has 1 ACTIVE direct
    ]);
    expect(await maxUnlockedLevel('u', db)).toBe(1);
  });

  test('full qualification to L6, then 1-direct members gate L7', async () => {
    // Binary tree to depth 5 (all members at depths 0–5 have exactly 2 directs)
    const users = [U('u', null)];
    let frontier = ['u'];
    for (let depth = 1; depth <= 6; depth++) {
      const next = [];
      for (const parent of frontier) {
        for (const i of [1, 2]) {
          const id = `${parent}-d${depth}-${i}`;
          users.push(U(id, parent));
          next.push(id);
        }
      }
      frontier = next;
    }
    // depth-6 members each get exactly 1 direct -> L7 unlocks
    for (const parent of frontier) {
      users.push(U(`${parent}-leaf`, parent));
    }
    const db = makeDb(users);
    expect(await maxUnlockedLevel('u', db)).toBe(7);
  });

  test('depth-6 member with no directs keeps L7 locked', async () => {
    const users = [U('u', null)];
    let frontier = ['u'];
    for (let depth = 1; depth <= 6; depth++) {
      const next = [];
      for (const parent of frontier) {
        for (const i of [1, 2]) {
          const id = `${parent}-d${depth}-${i}`;
          users.push(U(id, parent));
          next.push(id);
        }
      }
      frontier = next;
    }
    // give only ONE depth-6 member a direct; the rest fail the 1-direct rule
    users.push(U('only-child', frontier[0]));
    const db = makeDb(users);
    expect(await maxUnlockedLevel('u', db)).toBe(6);
  });
});

describe('levelQualificationTree stats', () => {
  test('reports members, qualified and unqualified counts per depth', async () => {
    const db = makeDb([
      U('u', null), U('a', 'u'), U('b', 'u'),
      U('a1', 'a'), U('a2', 'a'), // a qualified; b not
    ]);
    const depths = await levelQualificationTree('u', db);
    expect(depths[0]).toMatchObject({ depth: 0, members: 1, qualified: 1, allQualified: true });
    expect(depths[1]).toMatchObject({
      depth: 1,
      members: 2,
      qualified: 1,
      unqualified: 1,
      allQualified: false,
    });
    // depth 1 failed -> nothing deeper is evaluated as unlocked
    expect(await maxUnlockedLevel('u', db)).toBe(1);
  });
});
