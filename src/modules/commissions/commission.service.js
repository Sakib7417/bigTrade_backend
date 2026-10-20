import { prisma } from '../../config/database.js';
import { WalletService } from '../wallet/wallet.service.js';
import { getUplineChain } from '../../utils/referral.js';
import { getLevelPercents, maxUnlockedLevel } from '../../utils/commission.js';
import { capIncome } from '../../utils/earnings.js';
import { toDecimal, roundMoney } from '../../utils/money.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();

export class CommissionService {
  // 5% direct commission on a new investment - exactly once per investment.
  // Accepts an optional transaction client so callers can make it atomic.
  async distributeDirectCommission(investmentId, userId, investmentAmount, existingTx = null) {
    const run = async (tx) => {
      // Get user to find referrer
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { referredBy: true },
      });

      if (!user?.referredBy) {
        logger.info(`No referrer for user ${userId}, skipping direct commission`);
        return null;
      }

      const referrer = user.referredBy;

      // Check if referrer is active
      if (referrer.status !== 'ACTIVE') {
        logger.info(`Referrer ${referrer.id} is not active, skipping direct commission`);
        return null;
      }

      // Check if commission already exists (idempotency)
      const existingCommission = await tx.commission.findFirst({
        where: {
          userId: referrer.id,
          type: 'DIRECT',
          referenceType: 'INVESTMENT',
          referenceId: investmentId,
        },
      });

      if (existingCommission) {
        logger.info(`Direct commission already exists for investment ${investmentId}`);
        return { commission: existingCommission, duplicate: true };
      }

      // Get direct commission percent
      const directPercent = toDecimal(await this.getDirectCommissionPercent());
      const commissionAmount = roundMoney(toDecimal(investmentAmount).mul(directPercent).div(100));

      // Promoter cap: commission counts toward the referrer's 10x total income
      const creditable = await capIncome(referrer.id, commissionAmount, tx);
      if (creditable.lte(0)) {
        logger.info(`Direct commission skipped — 10x income cap reached for ${referrer.id}`);
        return null;
      }

      // Credit referrer's wallet inside the same transaction
      await walletService.creditTx(
        tx,
        referrer.id,
        creditable,
        'DIRECT_COMMISSION',
        'COMMISSION',
        investmentId,
        `Direct commission from ${user.name}'s investment`,
        { sourceUserId: userId, investmentId },
        `direct-commission:${investmentId}:${referrer.id}`
      );

      // Create commission record (unique constraint guards duplicates)
      const commission = await tx.commission.create({
        data: {
          userId: referrer.id,
          sourceUserId: userId,
          type: 'DIRECT',
          percent: directPercent,
          amount: creditable,
          referenceType: 'INVESTMENT',
          referenceId: investmentId,
          description: `Direct commission from ${user.name}'s investment`,
        },
      });

      // Update investment's commission generated
      await tx.investment.update({
        where: { id: investmentId },
        data: {
          totalCommissionGenerated: {
            increment: creditable,
          },
        },
      });

      logger.info(
        `Direct commission distributed: Referrer ${referrer.id}, Amount ${creditable}, Investment ${investmentId}`
      );

      return { commission, duplicate: false };
    };

    return existingTx ? run(existingTx) : prisma.$transaction(run);
  }

  // 20-level income on a downline's ROI event. Must run inside a transaction
  // when called from ROI processing; standalone wrapper provided.
  async distributeLevelIncomeTx(tx, sourceUserId, roiAmount, referenceType, referenceId) {
    const amount = toDecimal(roiAmount);
    const levelPercents = await getLevelPercents(tx);
    const maxLevel = await this.getMaxReferralLevel();

    // Walk only the upline chain up to the configured max level
    const uplineChain = await getUplineChain(sourceUserId, maxLevel, tx);

    if (uplineChain.length === 0) {
      return [];
    }

    const commissions = [];
    const unlockedCache = new Map();
    const unlockedFor = async (userId) => {
      if (!unlockedCache.has(userId)) {
        unlockedCache.set(userId, await maxUnlockedLevel(userId, tx));
      }
      return unlockedCache.get(userId);
    };

    for (const upline of uplineChain) {
      const levelPercent = levelPercents[upline.level];

      if (!levelPercent) {
        continue;
      }

      // Check if upline user is active
      const uplineUser = await tx.user.findUnique({
        where: { id: upline.userId },
        select: { id: true, status: true },
      });

      if (!uplineUser || uplineUser.status !== 'ACTIVE') {
        continue;
      }

      // Sequential unlock gate: every member in each preceding level of the
      // upline's tree must satisfy its direct-referral requirement
      const unlocked = await unlockedFor(upline.userId);

      if (upline.level > unlocked) {
        logger.info(
          `Level ${upline.level} locked for user ${upline.userId}: only levels 1-${unlocked} qualified`
        );
        continue;
      }

      // Skip duplicates (idempotency)
      const existing = await tx.commission.findFirst({
        where: {
          userId: upline.userId,
          type: 'LEVEL',
          referenceType,
          referenceId,
        },
      });

      if (existing) {
        continue;
      }

      // Calculate commission
      const commissionAmount = roundMoney(amount.mul(toDecimal(levelPercent)).div(100));

      if (commissionAmount.lte(0)) {
        continue;
      }

      // Promoter cap: level income counts toward the upline's 10x total income
      const creditable = await capIncome(upline.userId, commissionAmount, tx);
      if (creditable.lte(0)) {
        logger.info(`Level ${upline.level} commission skipped — 10x cap reached for ${upline.userId}`);
        continue;
      }

      // Credit wallet inside the same transaction
      await walletService.creditTx(
        tx,
        upline.userId,
        creditable,
        'LEVEL_COMMISSION',
        'COMMISSION',
        referenceId,
        `Level ${upline.level} commission from downline ${referenceType.toLowerCase()} income`,
        { sourceUserId, level: upline.level, referenceId },
        `level-commission:${referenceId}:${upline.userId}`
      );

      // Create commission record
      const commission = await tx.commission.create({
        data: {
          userId: upline.userId,
          sourceUserId,
          type: 'LEVEL',
          level: upline.level,
          percent: levelPercent,
          amount: creditable,
          referenceType,
          referenceId,
          description: `Level ${upline.level} commission from downline`,
        },
      });

      commissions.push(commission);
    }

    if (commissions.length) {
      logger.info(
        `Level income distributed: ${commissions.length} commissions for ${referenceType} ${referenceId}`
      );
    }

    return commissions;
  }

  async distributeLevelIncome(sourceUserId, roiAmount, referenceType, referenceId) {
    return prisma.$transaction((tx) =>
      this.distributeLevelIncomeTx(tx, sourceUserId, roiAmount, referenceType, referenceId)
    );
  }

  async getCommissions(userId, page = 1, limit = 10, type = null) {
    const skip = (page - 1) * limit;

    const where = { userId };
    if (type) {
      where.type = type;
    }

    const [commissions, total] = await Promise.all([
      prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sourceUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.commission.count({ where }),
    ]);

    return {
      commissions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAllCommissions(page = 1, limit = 10, type = null, userId = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (type) where.type = type;
    if (userId) where.userId = userId;

    const [commissions, total] = await Promise.all([
      prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          sourceUser: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.commission.count({ where }),
    ]);

    return {
      commissions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getCommissionStats(userId) {
    const [directTotal, levelTotal, totalCount] = await Promise.all([
      prisma.commission.aggregate({
        where: { userId, type: 'DIRECT' },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { userId, type: 'LEVEL' },
        _sum: { amount: true },
      }),
      prisma.commission.count({ where: { userId } }),
    ]);

    return {
      totalDirectIncome: directTotal._sum.amount || 0,
      totalLevelIncome: levelTotal._sum.amount || 0,
      totalCommissions: totalCount,
    };
  }

  async getDirectCommissionPercent() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'DIRECT_COMMISSION_PERCENT' },
    });

    return setting ? setting.value : '5';
  }

  async getMaxReferralLevel() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'MAX_REFERRAL_LEVEL' },
    });

    return setting ? parseInt(setting.value, 10) : 20;
  }
}
