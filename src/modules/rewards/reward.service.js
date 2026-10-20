import { prisma } from '../../config/database.js';
import { WalletService } from '../wallet/wallet.service.js';
import { RANK_TABLE, matchRank } from '../../utils/ranks.js';
import { countActiveDirects } from '../../utils/commission.js';
import { earningCapInfo } from '../../utils/earnings.js';
import { toDecimal } from '../../utils/money.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();

// Rank milestone rewards. Each user's "legs" = the full subtree of every
// direct referral; leg volume = total investments (excl. CANCELLED) in that
// subtree. Rewards are one-time per rank — enforced by @@unique(userId, rank)
// and a wallet idempotency key.
export class RewardService {
  // Volume of every direct's entire downline (incl. the direct's own investments)
  async getLegs(userId, tx = prisma) {
    const directs = await tx.user.findMany({
      where: { referredById: userId },
      select: { id: true, name: true, referralCode: true, status: true },
    });

    const legs = [];
    for (const d of directs) {
      const rows = await tx.$queryRaw`
        WITH RECURSIVE sub AS (
          SELECT "id" FROM "User" WHERE "id" = ${d.id}
          UNION ALL
          SELECT u."id" FROM "User" u INNER JOIN sub s ON u."referredById" = s."id"
        )
        SELECT COALESCE(SUM(i."amount"), 0)::text AS volume
        FROM "Investment" i
        WHERE i."userId" IN (SELECT "id" FROM sub) AND i."status" != 'CANCELLED'
      `;
      legs.push({
        directUserId: d.id,
        name: d.name,
        referralCode: d.referralCode,
        status: d.status,
        volume: toDecimal(rows[0]?.volume ?? '0'),
      });
    }
    return legs;
  }

  async activeDirects(userId, tx = prisma) {
    return countActiveDirects(userId, tx);
  }

  // Evaluate one user and award any newly achieved ranks. Atomic per user.
  async evaluateUser(userId) {
    return prisma.$transaction(async (tx) => {
      const [directs, legs] = await Promise.all([
        this.activeDirects(userId, tx),
        this.getLegs(userId, tx),
      ]);
      const legVolumes = legs.map((l) => l.volume);

      const awarded = await tx.rankReward.findMany({
        where: { userId },
        select: { rank: true },
      });
      const already = new Set(awarded.map((a) => a.rank));

      const newAwards = [];
      const incomeInfo = await earningCapInfo(userId, tx);
      let incomeRemaining = incomeInfo.remaining;

      for (const rankDef of RANK_TABLE) {
        if (already.has(rankDef.rank)) continue;
        const match = matchRank(rankDef, directs, legVolumes);
        if (!match) continue;

        // Promoter cap: rewards count toward the 10x total income — if the
        // cap is exhausted the milestone stays unclaimed until a top-up.
        const payable = toDecimal(rankDef.reward).lte(incomeRemaining)
          ? toDecimal(rankDef.reward)
          : incomeRemaining;
        if (payable.lte(0)) {
          logger.info(`Rank ${rankDef.rank} for ${userId} deferred — 10x income cap reached`);
          continue;
        }
        incomeRemaining = incomeRemaining.sub(payable);

        const reward = await tx.rankReward.create({
          data: {
            userId,
            rank: rankDef.rank,
            reward: payable,
            legsUsed: { activeDirects: directs, matchedLegs: match.qualifiedLegs, requirement: match.count + ' legs x ' + match.volume },
          },
        });

        await walletService.creditTx(
          tx,
          userId,
          payable,
          'RANK_REWARD',
          'RANK_REWARD',
          reward.id,
          `Rank ${rankDef.rank} milestone reward`,
          { rank: rankDef.rank },
          `rank-reward:${userId}:${rankDef.rank}`
        );

        newAwards.push(reward);
        logger.info(`Rank ${rankDef.rank} reward of ${rankDef.reward} USDT awarded to user ${userId}`);
      }

      return { awarded: newAwards, activeDirects: directs, legs };
    });
  }

  // A new investment can push ancestors over a milestone — evaluate the chain up
  async evaluateAncestors(userId) {
    const results = [];
    let current = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true },
    });

    let guard = 0;
    while (current?.referredById && guard++ < 50) {
      try {
        const r = await this.evaluateUser(current.referredById);
        results.push(r);
      } catch (err) {
        logger.error(`Rank evaluation failed for ${current.referredById}:`, err);
      }
      current = await prisma.user.findUnique({
        where: { id: current.referredById },
        select: { referredById: true },
      });
    }
    return results;
  }

  async evaluateAll() {
    const users = await prisma.user.findMany({
      where: { referrals: { some: {} } },
      select: { id: true },
    });
    let awarded = 0;
    for (const u of users) {
      try {
        const r = await this.evaluateUser(u.id);
        awarded += r.awarded.length;
      } catch (err) {
        logger.error(`Rank evaluation failed for ${u.id}:`, err);
      }
    }
    return { evaluated: users.length, awarded };
  }

  // User-facing: claimed rewards + live progress toward every rank
  async getMyRewards(userId) {
    const [claimed, directs, legs] = await Promise.all([
      prisma.rankReward.findMany({
        where: { userId },
        orderBy: { rank: 'asc' },
      }),
      this.activeDirects(userId),
      this.getLegs(userId),
    ]);

    const claimedRanks = new Set(claimed.map((c) => c.rank));
    const legVolumes = legs.map((l) => l.volume);

    const ranks = RANK_TABLE.map((r) => {
      const match = matchRank(r, directs, legVolumes);
      return {
        rank: r.rank,
        reward: r.reward,
        directsRequired: r.directs,
        alternatives: r.alternatives,
        qualified: Boolean(match),
        claimed: claimedRanks.has(r.rank),
        legsMet: match ? match.qualifiedLegs.length : 0,
      };
    });

    return {
      claimed,
      totalEarned: claimed.reduce((s, c) => s.add(toDecimal(c.reward)), toDecimal(0)),
      activeDirects: directs,
      legs: legs.map((l) => ({
        directUserId: l.directUserId,
        name: l.name,
        referralCode: l.referralCode,
        status: l.status,
        volume: l.volume.toString(),
      })),
      ranks,
    };
  }
}

export const rewardService = new RewardService();
