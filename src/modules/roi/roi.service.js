import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import { InvestmentService } from '../investments/investment.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { toDecimal } from '../../utils/money.js';
import { calculateRoiAmount, applyEarningCap, getCurrentPeriod } from '../../utils/roi.js';
import { earningCapInfo } from '../../utils/earnings.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();
const investmentService = new InvestmentService();
const commissionService = new CommissionService();

export class RoiService {
  async setGlobalRoi(roiPercent, period, adminId = null, ipAddress = null) {
    const percent = toDecimal(roiPercent);
    await this.assertRoiInRange(percent);

    const config = await prisma.$transaction(async (tx) => {
      const existing = await tx.roiConfiguration.findFirst({
        where: {
          type: 'GLOBAL',
          period,
          userId: null,
          investmentId: null,
        },
      });

      const saved = existing
        ? await tx.roiConfiguration.update({
            where: { id: existing.id },
            data: { roiPercent: percent, isActive: true },
          })
        : await tx.roiConfiguration.create({
            data: {
              type: 'GLOBAL',
              roiPercent: percent,
              period,
              isActive: true,
            },
          });

      if (adminId) {
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'ADMIN_SET_GLOBAL_ROI',
            targetType: 'ROI_CONFIGURATION',
            targetId: saved.id,
            ipAddress,
            metadata: { roiPercent: percent.toString(), period },
          },
        });
      }

      return saved;
    });

    return config;
  }

  async setUserRoi(userId, roiPercent, period, adminId = null, ipAddress = null) {
    const percent = toDecimal(roiPercent);
    await this.assertRoiInRange(percent);

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw new NotFoundError('User not found');
    }

    const config = await prisma.$transaction(async (tx) => {
      const existing = await tx.roiConfiguration.findFirst({
        where: {
          type: 'USER_CUSTOM',
          period,
          userId,
          investmentId: null,
        },
      });

      const saved = existing
        ? await tx.roiConfiguration.update({
            where: { id: existing.id },
            data: { roiPercent: percent, isActive: true },
          })
        : await tx.roiConfiguration.create({
            data: {
              type: 'USER_CUSTOM',
              roiPercent: percent,
              period,
              userId,
              isActive: true,
            },
          });

      if (adminId) {
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'ADMIN_SET_USER_ROI',
            targetType: 'ROI_CONFIGURATION',
            targetId: saved.id,
            targetUserId: userId,
            ipAddress,
            metadata: { roiPercent: percent.toString(), period },
          },
        });
      }

      return saved;
    });

    return config;
  }

  async setInvestmentRoi(investmentId, roiPercent, period, adminId = null, ipAddress = null) {
    const percent = toDecimal(roiPercent);
    await this.assertRoiInRange(percent);

    const target = await prisma.investment.findUnique({ where: { id: investmentId } });
    if (!target) {
      throw new NotFoundError('Investment not found');
    }

    const config = await prisma.$transaction(async (tx) => {
      const existing = await tx.roiConfiguration.findFirst({
        where: {
          type: 'INVESTMENT_CUSTOM',
          period,
          investmentId,
        },
      });

      const saved = existing
        ? await tx.roiConfiguration.update({
            where: { id: existing.id },
            data: { roiPercent: percent, isActive: true },
          })
        : await tx.roiConfiguration.create({
            data: {
              type: 'INVESTMENT_CUSTOM',
              roiPercent: percent,
              period,
              investmentId,
              isActive: true,
            },
          });

      if (adminId) {
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'ADMIN_SET_INVESTMENT_ROI',
            targetType: 'ROI_CONFIGURATION',
            targetId: saved.id,
            targetUserId: target.userId,
            ipAddress,
            metadata: { roiPercent: percent.toString(), period, investmentId },
          },
        });
      }

      return saved;
    });

    return config;
  }

  async getGlobalRoi(period) {
    return prisma.roiConfiguration.findFirst({
      where: {
        type: 'GLOBAL',
        period,
        userId: null,
        investmentId: null,
        isActive: true,
      },
    });
  }

  async getUserRoi(userId, period) {
    return prisma.roiConfiguration.findFirst({
      where: {
        type: 'USER_CUSTOM',
        period,
        userId,
        investmentId: null,
        isActive: true,
      },
    });
  }

  async getInvestmentRoi(investmentId, period) {
    return prisma.roiConfiguration.findFirst({
      where: {
        type: 'INVESTMENT_CUSTOM',
        period,
        investmentId,
        isActive: true,
      },
    });
  }

  // Priority: investment-specific > user-specific > global
  async getApplicableRoi(investmentId, userId, period, db = prisma) {
    const investmentConfig = await db.roiConfiguration.findFirst({
      where: {
        type: 'INVESTMENT_CUSTOM',
        period,
        investmentId,
        isActive: true,
      },
    });
    if (investmentConfig) return { roiPercent: investmentConfig.roiPercent, roiConfigId: investmentConfig.id };

    const userConfig = await db.roiConfiguration.findFirst({
      where: {
        type: 'USER_CUSTOM',
        period,
        userId,
        investmentId: null,
        isActive: true,
      },
    });
    if (userConfig) return { roiPercent: userConfig.roiPercent, roiConfigId: userConfig.id };

    const globalConfig = await db.roiConfiguration.findFirst({
      where: {
        type: 'GLOBAL',
        period,
        userId: null,
        investmentId: null,
        isActive: true,
      },
    });
    if (globalConfig) return { roiPercent: globalConfig.roiPercent, roiConfigId: globalConfig.id };

    return null;
  }

  // Processes a single investment for the period atomically:
  // ROI credit + earning record + stats + 20-level income in ONE transaction.
  async processInvestmentRoi(investmentId, period) {
    return prisma.$transaction(async (tx) => {
      // Lock the investment row so concurrent runs can't double-process
      const rows = await tx.$queryRaw`SELECT * FROM "Investment" WHERE id = ${investmentId} FOR UPDATE`;
      if (!rows.length) {
        throw new NotFoundError('Investment not found');
      }
      const investment = rows[0];

      if (investment.status !== 'ACTIVE') {
        return { skipped: true, reason: 'NOT_ACTIVE' };
      }

      // Below-minimum investments earn no ROI ($100 minimum per plan)
      const minInvestment = toDecimal(await investmentService.getMinInvestment());
      if (toDecimal(investment.principal).lt(minInvestment)) {
        return { skipped: true, reason: 'BELOW_MIN_INVESTMENT' };
      }

      // Idempotency: unique (investmentId, period) prevents double ROI
      const existingEarning = await tx.roiEarning.findUnique({
        where: {
          investmentId_period: {
            investmentId: investment.id,
            period,
          },
        },
      });

      if (existingEarning) {
        return { skipped: true, reason: 'ALREADY_PROCESSED' };
      }

      // Determine applicable ROI (investment > user > global)
      const applicable = await this.getApplicableRoi(investment.id, investment.userId, period, tx);
      if (!applicable) {
        return { skipped: true, reason: 'NO_ROI_CONFIG' };
      }

      // Calculate ROI: principal * roiPercent / 100
      const roiAmount = calculateRoiAmount(investment.amount, applicable.roiPercent);

      // Apply 5x earning cap (server-side, locked row)
      const cap = applyEarningCap(roiAmount, investment.totalRoiEarned, investment.earningCap);
      if (!cap.eligible) {
        await tx.investment.update({
          where: { id: investment.id },
          data: { status: 'CAPPED' },
        });
        return { skipped: true, reason: 'CAPPED' };
      }

      // Global promoter cap: ALL income types combined vs 10x invested
      const userCap = await earningCapInfo(investment.userId, tx);
      if (userCap.remaining.lte(0)) {
        await tx.investment.update({
          where: { id: investment.id },
          data: { status: 'CAPPED' },
        });
        return { skipped: true, reason: 'INCOME_CAP_REACHED' };
      }

      let creditable = cap.creditable;
      if (creditable.gt(userCap.remaining)) creditable = userCap.remaining;

      // Credit wallet
      const { transaction } = await walletService.creditTx(
        tx,
        investment.userId,
        creditable,
        'ROI',
        'ROI',
        investment.id,
        `Monthly ROI for ${period}`,
        { period, roiPercent: applicable.roiPercent.toString() },
        `roi:${investment.id}:${period}`
      );

      // Create ROI earning record (unique constraint = idempotency)
      const earning = await tx.roiEarning.create({
        data: {
          userId: investment.userId,
          investmentId: investment.id,
          roiPercent: applicable.roiPercent,
          roiAmount: creditable,
          period,
          roiConfigId: applicable.roiConfigId,
        },
      });

      // Update investment stats
      await tx.investment.update({
        where: { id: investment.id },
        data: {
          totalRoiEarned: { increment: creditable },
          ...(cap.capped && { status: 'CAPPED' }),
        },
      });

      // Distribute 20-level income on this trade/ROI income event
      const commissions = await commissionService.distributeLevelIncomeTx(
        tx,
        investment.userId,
        creditable,
        'ROI',
        earning.id
      );

      const totalCommission = commissions.reduce(
        (sum, c) => sum.add(toDecimal(c.amount)),
        toDecimal(0)
      );

      if (totalCommission.gt(0)) {
        await tx.investment.update({
          where: { id: investment.id },
          data: { totalCommissionGenerated: { increment: totalCommission } },
        });
      }

      return {
        skipped: false,
        earning,
        transaction,
        creditable,
        roiPercent: applicable.roiPercent,
        capped: cap.capped,
        commissions: commissions.length,
      };
    });
  }

  async processMonthlyRoi(period) {
    logger.info(`Starting monthly ROI processing for period: ${period}`);

    // Only fetch IDs first - each investment is processed in its own
    // atomic transaction, so a single failure doesn't break the batch.
    const investments = await prisma.investment.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let totalRoiDistributed = toDecimal(0);

    for (const { id } of investments) {
      try {
        const result = await this.processInvestmentRoi(id, period);

        if (result.skipped) {
          skippedCount++;
        } else {
          processedCount++;
          totalRoiDistributed = totalRoiDistributed.add(result.creditable);
          logger.info(
            `ROI processed: Investment ${id}, Amount ${result.creditable}, Level commissions: ${result.commissions}`
          );
        }
      } catch (error) {
        failedCount++;
        logger.error(`Error processing ROI for investment ${id}:`, error);
      }
    }

    logger.info(
      `ROI processing complete: ${processedCount} processed, ${skippedCount} skipped, ${failedCount} failed, Total: $${totalRoiDistributed}`
    );

    return {
      period,
      processedCount,
      skippedCount,
      failedCount,
      totalRoiDistributed,
    };
  }

  async getUserRoiSummary(userId) {
    const period = getCurrentPeriod();

    const [earnings, totals, activeInvestments] = await Promise.all([
      prisma.roiEarning.findMany({
        where: { userId, period },
      }),
      prisma.roiEarning.aggregate({
        where: { userId },
        _sum: { roiAmount: true },
        _count: true,
      }),
      prisma.investment.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { id: true, amount: true, earningCap: true, totalRoiEarned: true },
      }),
    ]);

    // Applicable ROI for the user's first active investment (representative)
    let currentRoi = null;
    if (activeInvestments.length) {
      const applicable = await this.getApplicableRoi(activeInvestments[0].id, userId, period);
      currentRoi = applicable ? applicable.roiPercent : null;
    }

    return {
      period,
      currentRoiPercent: currentRoi,
      thisMonthEarnings: earnings,
      totalRoiEarned: totals._sum.roiAmount || 0,
      totalRoiEvents: totals._count,
      activeInvestments,
    };
  }

  async getRoiHistory(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [earnings, total] = await Promise.all([
      prisma.roiEarning.findMany({
        where: { userId },
        include: {
          investment: {
            select: {
              id: true,
              amount: true,
              status: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.roiEarning.count({ where: { userId } }),
    ]);

    return {
      earnings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAllRoiEarnings(page = 1, limit = 10, period = null, userId = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (period) where.period = period;
    if (userId) where.userId = userId;

    const [earnings, total] = await Promise.all([
      prisma.roiEarning.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          investment: { select: { id: true, amount: true, status: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.roiEarning.count({ where }),
    ]);

    return {
      earnings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRoiConfigurations(page = 1, limit = 10, type = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (type) {
      where.type = type;
    }

    const [configs, total] = await Promise.all([
      prisma.roiConfiguration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          investment: {
            select: {
              id: true,
              amount: true,
            },
          },
        },
      }),
      prisma.roiConfiguration.count({ where }),
    ]);

    return {
      configs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getGlobalRoiHistory(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const where = { type: 'GLOBAL' };

    const [configs, total] = await Promise.all([
      prisma.roiConfiguration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { period: 'desc' },
      }),
      prisma.roiConfiguration.count({ where }),
    ]);

    return {
      configs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserRoiConfigs(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const where = { type: 'USER_CUSTOM', userId };

    const [configs, total] = await Promise.all([
      prisma.roiConfiguration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { period: 'desc' },
      }),
      prisma.roiConfiguration.count({ where }),
    ]);

    return {
      configs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteUserRoi(userId, period, adminId = null, ipAddress = null) {
    const where = {
      type: 'USER_CUSTOM',
      userId,
      ...(period && { period }),
    };

    const configs = await prisma.roiConfiguration.findMany({ where });

    if (!configs.length) {
      throw new NotFoundError('ROI configuration not found');
    }

    await prisma.$transaction(async (tx) => {
      await tx.roiConfiguration.deleteMany({
        where: { id: { in: configs.map((c) => c.id) } },
      });

      if (adminId) {
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'ADMIN_DELETE_USER_ROI',
            targetType: 'ROI_CONFIGURATION',
            targetUserId: userId,
            ipAddress,
            metadata: { period, deletedCount: configs.length },
          },
        });
      }
    });

    return { message: 'ROI configuration deleted', deletedCount: configs.length };
  }

  async getRoiRange() {
    const [minSetting, maxSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'MIN_ROI_PERCENT' } }),
      prisma.systemSetting.findUnique({ where: { key: 'MAX_ROI_PERCENT' } }),
    ]);

    return {
      minPercent: minSetting ? parseFloat(minSetting.value) : 6,
      maxPercent: maxSetting ? parseFloat(maxSetting.value) : 12,
    };
  }

  async assertRoiInRange(roiPercent) {
    const { minPercent, maxPercent } = await this.getRoiRange();
    const percent = toDecimal(roiPercent);
    if (percent.lt(minPercent) || percent.gt(maxPercent)) {
      throw new ConflictError(`ROI must be between ${minPercent}% and ${maxPercent}%`);
    }
  }
}
