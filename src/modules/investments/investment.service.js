import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { rewardService } from '../rewards/reward.service.js';
import { toDecimal } from '../../utils/money.js';
import { applyEarningCap } from '../../utils/roi.js';
import { capitalDeductionPercent } from '../../utils/capital.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();
const commissionService = new CommissionService();
const MS_DAY = 24 * 60 * 60 * 1000;

// Fire-and-forget rank evaluation for upline — never blocks or breaks investing
const evaluateRankRewards = (userId) => {
  rewardService.evaluateAncestors(userId).catch((err) =>
    logger.error(`Rank reward evaluation failed for ${userId}:`, err)
  );
};

export class InvestmentService {
  // Adds a tranche to the user's live investment (amount/principal/cap grow) or
  // creates a new one when none exists. Ledger idempotency protects the merge.
  async applyTrancheTx(tx, { userId, value, capMultiplier, idempotencyKey, mergeIntoId = null }) {
    const ledgerKey = idempotencyKey ? `${idempotencyKey}:investment` : null;
    if (ledgerKey) {
      const seen = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: ledgerKey },
        select: { referenceId: true },
      });
      if (seen) {
        const inv = await tx.investment.findUnique({ where: { id: seen.referenceId } });
        if (inv) return { investment: inv, duplicate: true };
      }
    }

    const live = mergeIntoId
      ? await tx.investment.findFirst({ where: { id: mergeIntoId, userId } })
      : await tx.investment.findFirst({
          where: { userId, status: { in: ['ACTIVE', 'CAPPED', 'INACTIVE'] } },
          orderBy: { createdAt: 'asc' },
        });

    if (live) {
      const investment = await tx.investment.update({
        where: { id: live.id },
        data: {
          amount: { increment: value },
          principal: { increment: value },
          earningCap: { increment: value.mul(capMultiplier) },
          status: 'ACTIVE',
        },
      });
      // Audit trail: record this tranche on the cycle ledger
      await tx.investmentCycle.create({
        data: {
          investmentId: live.id,
          cycleNumber: (await tx.investmentCycle.count({ where: { investmentId: live.id } })) + 1,
          amount: value,
          earningCap: value.mul(capMultiplier),
          status: 'ACTIVE',
        },
      });
      return { investment, duplicate: false, merged: true };
    }

    const investment = await tx.investment.create({
      data: {
        userId,
        amount: value,
        principal: value,
        status: 'ACTIVE',
        earningCap: value.mul(capMultiplier),
        totalRoiEarned: 0,
        totalCommissionGenerated: 0,
        idempotencyKey,
      },
    });
    return { investment, duplicate: false, merged: false };
  }

  async createInvestment(userId, amount, idempotencyKey = null) {
    const value = toDecimal(amount);

    const result = await prisma.$transaction(async (tx) => {
      // Idempotency: same key returns the original investment
      if (idempotencyKey) {
        const existing = await tx.investment.findUnique({ where: { idempotencyKey } });
        if (existing) return { investment: existing, duplicate: true };
      }

      // Check minimum investment
      const minInvestment = toDecimal(await this.getMinInvestment());
      if (value.lt(minInvestment)) {
        throw new ConflictError(`Minimum investment is $${minInvestment}`);
      }

      // Calculate earning cap (promoter capping, default 10x)
      const capMultiplier = await this.getEarningCapMultiplier(tx);

      // Merge into the live investment or create one
      const { investment, duplicate } = await this.applyTrancheTx(tx, {
        userId, value, capMultiplier, idempotencyKey,
      });
      if (duplicate) return { investment, duplicate: true };

      // Debit wallet (locks wallet row, creates ledger entry)
      await walletService.debitTx(
        tx,
        userId,
        value,
        'INVESTMENT',
        'INVESTMENT',
        investment.id,
        'Investment created',
        null,
        idempotencyKey ? `${idempotencyKey}:investment` : null
      );

      // Direct referral commission (5%) - inside the same transaction
      await commissionService.distributeDirectCommission(investment.id, userId, value, tx);

      logger.info(`Investment created: User ${userId}, Amount ${value}, ID ${investment.id}`);

      return { investment, duplicate: false };
    });

    if (!result.duplicate) {
      evaluateRankRewards(userId);
    }
    return result;
  }

  async topUpInvestment(userId, investmentId, amount, idempotencyKey = null) {
    const value = toDecimal(amount);

    const result = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.investment.findUnique({ where: { idempotencyKey } });
        if (existing) return { investment: existing, duplicate: true };
      }

      // Get existing investment
      const investment = await tx.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new NotFoundError('Investment not found');
      }

      if (investment.userId !== userId) {
        throw new ConflictError('Not authorized to top-up this investment');
      }

      // Check minimum investment
      const minInvestment = toDecimal(await this.getMinInvestment());
      if (value.lt(minInvestment)) {
        throw new ConflictError(`Minimum top-up is $${minInvestment}`);
      }

      const capMultiplier = await this.getEarningCapMultiplier(tx);

      // Top-up merges into this investment — principal, amount and cap all grow
      const { investment: newInvestment, duplicate } = await this.applyTrancheTx(tx, {
        userId,
        value,
        capMultiplier,
        idempotencyKey,
        mergeIntoId: investmentId,
      });
      if (duplicate) return { investment: newInvestment, duplicate: true };

      // Debit wallet
      await walletService.debitTx(
        tx,
        userId,
        value,
        'TOP_UP',
        'INVESTMENT',
        newInvestment.id,
        'Investment top-up',
        { previousInvestmentId: investmentId },
        idempotencyKey ? `${idempotencyKey}:topup` : null
      );

      // Direct referral commission on the new tranche - inside the same transaction
      await commissionService.distributeDirectCommission(newInvestment.id, userId, value, tx);

      logger.info(`Investment top-up: User ${userId}, Amount ${value}, New ID ${newInvestment.id}`);

      return { investment: newInvestment, duplicate: false };
    });

    if (!result.duplicate) {
      evaluateRankRewards(userId);
    }
    return result;
  }

  async getInvestments(userId, page = 1, limit = 10, status = null) {
    const skip = (page - 1) * limit;

    const where = { userId };
    if (status) {
      where.status = status;
    }

    const [investments, total] = await Promise.all([
      prisma.investment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.investment.count({ where }),
    ]);

    return {
      investments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInvestmentById(investmentId, userId) {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
      include: {
        roiEarnings: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!investment) {
      throw new NotFoundError('Investment not found');
    }

    if (investment.userId !== userId) {
      throw new ConflictError('Not authorized to view this investment');
    }

    return investment;
  }

  // Must be called inside a transaction - locks the investment row
  async checkEarningCapTx(tx, investmentId, amount) {
    const rows = await tx.$queryRaw`SELECT * FROM "Investment" WHERE id = ${investmentId} FOR UPDATE`;

    if (!rows.length) {
      throw new NotFoundError('Investment not found');
    }

    const investment = rows[0];
    const result = applyEarningCap(amount, investment.totalRoiEarned, investment.earningCap);

    if (result.capped && investment.status === 'ACTIVE') {
      await tx.investment.update({
        where: { id: investmentId },
        data: { status: 'CAPPED' },
      });
    }

    return result;
  }

  async checkEarningCap(investmentId, amount) {
    return prisma.$transaction((tx) => this.checkEarningCapTx(tx, investmentId, amount));
  }

  async updateInvestmentStats(investmentId, roiAmount, commissionAmount, tx = prisma) {
    return await tx.investment.update({
      where: { id: investmentId },
      data: {
        totalRoiEarned: {
          increment: toDecimal(roiAmount),
        },
        totalCommissionGenerated: {
          increment: toDecimal(commissionAmount),
        },
      },
    });
  }

  async getMinInvestment() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'MIN_INVESTMENT' },
    });

    return setting ? setting.value : '100';
  }

  async getEarningCapMultiplier(tx = prisma) {
    const setting = await tx.systemSetting.findUnique({
      where: { key: 'EARNING_CAP_MULTIPLIER' },
    });
    return toDecimal(setting?.value ?? '10');
  }

  // Principal withdrawal eligibility — age-based capital deduction per plan
  // (10% <30d, 8% ≤60d, 6% ≤90d, 4% ≤120d, 2% ≤150d, 0% after)
  getPrincipalEligibility(investment) {
    const principal = toDecimal(investment.principal);
    const pct = toDecimal(capitalDeductionPercent(investment.startedAt));
    const penalty = principal.mul(pct).div(100);
    const eligible = principal.sub(penalty);
    const lockEndDate = new Date(new Date(investment.startedAt).getTime() + 150 * MS_DAY);

    return {
      principal,
      lockEndDate,
      isEarly: pct.gt(0),
      penaltyPercent: pct,
      penalty,
      eligible,
    };
  }
}
