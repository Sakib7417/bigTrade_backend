import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../middleware/error.middleware.js';
import { getReferralTree, getDirectReferrals } from '../../utils/referral.js';
import { levelQualificationTree, requiredDirectsForLevel, DEFAULT_LEVEL_PERCENTS, countActiveDirects } from '../../utils/commission.js';
import logger from '../../config/logger.js';

export class ReferralService {
  async getReferralTree(userId) {
    const tree = await getReferralTree(userId);

    if (!tree) {
      throw new NotFoundError('User not found');
    }

    return tree;
  }

  async getDirectReferrals(userId, page = 1, limit = 10) {
    return await getDirectReferrals(userId, page, limit);
  }

  async getReferralsByLevel(userId, level, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    // Get user's referrals recursively
    const getLevelUsers = async (parentId, currentLevel, targetLevel) => {
      if (currentLevel > targetLevel) return [];

      const children = await prisma.user.findMany({
        where: { referredById: parentId },
        select: {
          id: true,
          name: true,
          email: true,
          referralCode: true,
          status: true,
          createdAt: true,
        },
      });

      if (currentLevel === targetLevel) {
        return children;
      }

      const result = [];
      for (const child of children) {
        const nestedChildren = await getLevelUsers(child.id, currentLevel + 1, targetLevel);
        result.push(...nestedChildren);
      }

      return result;
    };

    const users = await getLevelUsers(userId, 1, level);
    const total = users.length;

    const paginatedUsers = users.slice(skip, skip + limit);

    return {
      referrals: paginatedUsers,
      total,
      page,
      limit,
      level,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getReferralStats(userId) {
    const [directCount, activeDirects, totalTeamCount, totalInvestments] = await Promise.all([
      prisma.user.count({ where: { referredById: userId } }),
      countActiveDirects(userId),
      this.getTotalTeamSize(userId),
      prisma.investment.aggregate({
        where: {
          user: {
            referredById: userId,
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Sequential level qualification across the referral tree
    const depths = await levelQualificationTree(userId);
    const depthMap = new Map(depths.map((d) => [d.depth, d]));

    const levelUnlocks = [];
    let chainBroken = false;
    let breakDepth = -1;

    for (let level = 1; level <= 20; level++) {
      const preceding = depthMap.get(level - 1); // members that gate this level
      const own = depthMap.get(level); // members at this level

      if (!chainBroken && preceding && !preceding.allQualified) {
        chainBroken = true;
        breakDepth = level - 1;
      }

      const members = own?.members ?? 0;
      const qualifiedMembers = own?.qualified ?? 0;

      levelUnlocks.push({
        level,
        percent: DEFAULT_LEVEL_PERCENTS[level],
        requiredDirects: requiredDirectsForLevel(level),
        members,
        qualifiedMembers,
        unqualifiedMembers: members - qualifiedMembers,
        unlocked: !chainBroken && members > 0,
        lockReason:
          chainBroken || members === 0
            ? breakDepth === 0
              ? 'You need 2 active directs (members with a live investment)'
              : breakDepth > 0
                ? `Level ${breakDepth} is not fully qualified`
                : 'No members at this level yet'
            : null,
      });
    }

    return {
      directReferrals: directCount,
      activeDirects,
      totalTeamSize: totalTeamCount,
      totalTeamInvestments: totalInvestments._count,
      totalTeamInvestmentAmount: totalInvestments._sum.amount || 0,
      levelUnlocks,
      unlockedLevels: levelUnlocks.filter((l) => l.unlocked).length,
    };
  }

  async getTotalTeamSize(userId) {
    const countTeam = async (parentId) => {
      const children = await prisma.user.findMany({
        where: { referredById: parentId },
        select: { id: true },
      });

      let count = children.length;
      for (const child of children) {
        count += await countTeam(child.id);
      }

      return count;
    };

    return await countTeam(userId);
  }

  async getReferrerInfo(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        referredBy: {
          select: {
            id: true,
            name: true,
            email: true,
            referralCode: true,
          },
        },
      },
    });

    return user?.referredBy || null;
  }
}
