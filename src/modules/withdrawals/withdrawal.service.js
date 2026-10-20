import { ethers } from 'ethers';
import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import { InvestmentService } from '../investments/investment.service.js';
import { toDecimal, roundMoney } from '../../utils/money.js';
import { getProvider, ERC20_TRANSFER_ABI } from '../../config/blockchain.js';
import config from '../../config/env.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();
const investmentService = new InvestmentService();
const transferIface = new ethers.Interface(ERC20_TRANSFER_ABI);

export class WithdrawalService {
  // Verify the admin's payout tx on-chain: a USDT transfer to the user's
  // destination address covering at least the net amount.
  async verifyPayoutTx(txHash, destinationAddress, netAmount) {
    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);

    if (!receipt || receipt.status !== 1) {
      throw new ConflictError('Payout transaction not found or failed on-chain');
    }

    const transfer = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === config.blockchain.usdtContract?.toLowerCase()
      )
      .map((log) => {
        try {
          return transferIface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(
        (parsed) =>
          parsed &&
          parsed.name === 'Transfer' &&
          parsed.args.to.toLowerCase() === destinationAddress.toLowerCase()
      );

    if (!transfer) {
      throw new ConflictError('Transaction is not a USDT transfer to the withdrawal address');
    }

    const sent = toDecimal(ethers.formatUnits(transfer.args.value, config.blockchain.usdtDecimals));
    if (sent.lt(toDecimal(netAmount))) {
      throw new ConflictError(
        `Payout amount ${sent} USDT is less than the net withdrawal ${netAmount} USDT`
      );
    }

    return { from: transfer.args.from, amount: sent };
  }

  async createWithdrawal(userId, amount, destinationAddress, bankDetails, idempotencyKey = null) {
    const value = toDecimal(amount);

    return await prisma.$transaction(async (tx) => {
      // Idempotency: replayed request returns the original withdrawal
      if (idempotencyKey) {
        const existing = await tx.withdrawal.findUnique({ where: { idempotencyKey } });
        if (existing) return { withdrawal: existing, duplicate: true };
      }

      // Check minimum withdrawal
      const minWithdrawal = toDecimal(await this.getMinWithdrawal());
      if (value.lt(minWithdrawal)) {
        throw new ConflictError(`Minimum withdrawal is $${minWithdrawal}`);
      }

      // Lock wallet row and reserve funds atomically (prevents double spending)
      const wallet = await walletService.lockFundsTx(tx, userId, value);

      // Calculate fee
      const feePercent = toDecimal(await this.getWithdrawalFeePercent());
      const fee = roundMoney(value.mul(feePercent).div(100));
      const netAmount = value.sub(fee);

      // Create withdrawal
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          kind: 'BALANCE',
          amount: value,
          fee,
          netAmount,
          status: 'PENDING',
          destinationAddress,
          bankDetails,
          idempotencyKey,
        },
      });

      // Ledger: full debit request (locked)
      await tx.walletTransaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: value,
          currency: 'USD',
          direction: 'DEBIT',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          status: 'PENDING',
          description: 'Withdrawal request',
          metadata: { bankDetails },
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:withdrawal` : null,
        },
      });

      // Ledger: fee portion
      await tx.walletTransaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'WITHDRAWAL_FEE',
          amount: fee,
          currency: 'USD',
          direction: 'DEBIT',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          status: 'PENDING',
          description: `Withdrawal fee (${feePercent}%)`,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee` : null,
        },
      });

      logger.info(`Withdrawal created: User ${userId}, Amount ${value}, ID ${withdrawal.id}`);

      return { withdrawal, duplicate: false };
    });
  }

  // Principal withdrawal: age-based capital deduction (10%→0% over 150 days)
  async createPrincipalWithdrawal(userId, investmentId, destinationAddress, bankDetails, idempotencyKey = null) {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.withdrawal.findUnique({ where: { idempotencyKey } });
        if (existing) return { withdrawal: existing, duplicate: true };
      }

      // Lock the investment row
      const rows = await tx.$queryRaw`SELECT * FROM "Investment" WHERE id = ${investmentId} FOR UPDATE`;
      const investment = rows[0];

      if (!investment) {
        throw new NotFoundError('Investment not found');
      }

      if (investment.userId !== userId) {
        throw new ConflictError('Not authorized to withdraw this investment');
      }

      if (investment.status === 'CANCELLED' || investment.status === 'COMPLETED') {
        throw new ConflictError('Investment is not withdrawable');
      }

      const eligibility = investmentService.getPrincipalEligibility(investment);

      if (eligibility.eligible.lte(0)) {
        throw new ConflictError('No withdrawable principal');
      }

      // Only the remaining principal can be withdrawn once
      const existingPrincipalWithdrawals = await tx.withdrawal.findMany({
        where: {
          investmentId,
          kind: 'PRINCIPAL',
          status: { in: ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'] },
        },
      });

      const alreadyWithdrawn = existingPrincipalWithdrawals.reduce(
        (sum, w) => sum.add(toDecimal(w.amount)),
        toDecimal(0)
      );

      const withdrawable = eligibility.eligible.sub(alreadyWithdrawn);
      if (withdrawable.lte(0)) {
        throw new ConflictError('Principal already withdrawn or pending withdrawal');
      }

      const wallet = await walletService.lockWalletRow(tx, userId);

      const feePercent = toDecimal(await this.getWithdrawalFeePercent());
      const fee = roundMoney(withdrawable.mul(feePercent).div(100));
      const netAmount = withdrawable.sub(fee);

      // Mark investment as completed once principal is withdrawn
      await tx.investment.update({
        where: { id: investmentId },
        data: { status: 'COMPLETED' },
      });

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          kind: 'PRINCIPAL',
          amount: withdrawable,
          fee,
          netAmount,
          principalPenalty: eligibility.penalty,
          investmentId,
          status: 'PENDING',
          destinationAddress,
          bankDetails,
          idempotencyKey,
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: withdrawable,
          currency: 'USD',
          direction: 'DEBIT',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          status: 'PENDING',
          description: `Principal withdrawal for investment ${investmentId}`,
          metadata: {
            investmentId,
            early: eligibility.isEarly,
            principalPenalty: eligibility.penalty,
          },
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:withdrawal` : null,
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'WITHDRAWAL_FEE',
          amount: fee,
          currency: 'USD',
          direction: 'DEBIT',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          status: 'PENDING',
          description: `Withdrawal fee (${feePercent}%)`,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:fee` : null,
        },
      });

      logger.info(
        `Principal withdrawal created: User ${userId}, Investment ${investmentId}, Amount ${withdrawable}, Early: ${eligibility.isEarly}`
      );

      return { withdrawal, duplicate: false, eligibility };
    });
  }

  async getPrincipalEligibility(userId, investmentId) {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
    });

    if (!investment) {
      throw new NotFoundError('Investment not found');
    }

    if (investment.userId !== userId) {
      throw new ConflictError('Not authorized to view this investment');
    }

    const eligibility = investmentService.getPrincipalEligibility(investment);

    const withdrawn = await prisma.withdrawal.findMany({
      where: {
        investmentId,
        kind: 'PRINCIPAL',
        status: { in: ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'] },
      },
      select: { amount: true },
    });

    const alreadyWithdrawn = withdrawn.reduce(
      (sum, w) => sum.add(toDecimal(w.amount)),
      toDecimal(0)
    );

    return {
      ...eligibility,
      alreadyWithdrawn,
      withdrawable: eligibility.eligible.sub(alreadyWithdrawn),
    };
  }

  async getWithdrawals(userId, page = 1, limit = 10, status = null) {
    const skip = (page - 1) * limit;

    const where = { userId };
    if (status) {
      where.status = status;
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.withdrawal.count({ where }),
    ]);

    return {
      withdrawals,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getWithdrawalById(withdrawalId, userId) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundError('Withdrawal not found');
    }

    if (withdrawal.userId !== userId) {
      throw new ConflictError('Not authorized to view this withdrawal');
    }

    return withdrawal;
  }

  async approveWithdrawal(withdrawalId, adminId, remarks = null, ipAddress = null) {
    return await prisma.$transaction(async (tx) => {
      // Lock withdrawal row to prevent double approval
      const rows = await tx.$queryRaw`SELECT * FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE`;
      const withdrawal = rows[0];

      if (!withdrawal) {
        throw new NotFoundError('Withdrawal not found');
      }

      if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PROCESSING') {
        throw new ConflictError('Withdrawal is not in a processable status');
      }

      if (withdrawal.kind !== 'PRINCIPAL') {
        // Settle locked funds - money leaves the platform
        await walletService.settleLockedTx(tx, withdrawal.userId, toDecimal(withdrawal.amount));
      }
      // PRINCIPAL withdrawals pay out externally; principal was never in the wallet

      // Update withdrawal status
      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'APPROVED',
          approvedBy: adminId,
          processedAt: new Date(),
        },
      });

      // Update transaction status
      await tx.walletTransaction.updateMany({
        where: {
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawalId,
        },
        data: {
          status: 'COMPLETED',
          description: remarks || 'Withdrawal approved',
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_APPROVE_WITHDRAWAL',
          targetType: 'WITHDRAWAL',
          targetId: withdrawalId,
          targetUserId: withdrawal.userId,
          ipAddress,
          metadata: {
            amount: withdrawal.amount,
            netAmount: withdrawal.netAmount,
            remarks,
          },
        },
      });

      logger.info(`Withdrawal approved: ID ${withdrawalId}, Admin ${adminId}`);

      return updatedWithdrawal;
    });
  }

  async rejectWithdrawal(withdrawalId, adminId, reason, ipAddress = null) {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE`;
      const withdrawal = rows[0];

      if (!withdrawal) {
        throw new NotFoundError('Withdrawal not found');
      }

      if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PROCESSING') {
        throw new ConflictError('Withdrawal is not in a processable status');
      }

      if (withdrawal.kind === 'PRINCIPAL') {
        // Restore investment so user retains the position
        if (withdrawal.investmentId) {
          await tx.investment.update({
            where: { id: withdrawal.investmentId },
            data: { status: 'ACTIVE' },
          });
        }
      } else {
        // Refund locked funds to available balance
        await walletService.unlockFundsTx(tx, withdrawal.userId, toDecimal(withdrawal.amount));
      }

      // Update withdrawal status
      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          processedAt: new Date(),
        },
      });

      // Update transaction status
      await tx.walletTransaction.updateMany({
        where: {
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawalId,
        },
        data: {
          status: 'CANCELLED',
          description: `Withdrawal rejected: ${reason}`,
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_REJECT_WITHDRAWAL',
          targetType: 'WITHDRAWAL',
          targetId: withdrawalId,
          targetUserId: withdrawal.userId,
          ipAddress,
          metadata: {
            amount: withdrawal.amount,
            reason,
          },
        },
      });

      logger.info(`Withdrawal rejected: ID ${withdrawalId}, Admin ${adminId}, Reason: ${reason}`);

      return updatedWithdrawal;
    });
  }

  async completeWithdrawal(withdrawalId, adminId, ipAddress = null, txHash = null) {
    // Same tx hash cannot be used to complete two withdrawals
    if (txHash) {
      const used = await prisma.withdrawal.findUnique({ where: { payoutTxHash: txHash } });
      if (used) {
        throw new ConflictError('This transaction hash was already used for another withdrawal');
      }
    }

    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE`;
      const withdrawal = rows[0];

      if (!withdrawal) {
        throw new NotFoundError('Withdrawal not found');
      }

      if (withdrawal.status !== 'APPROVED' && withdrawal.status !== 'PENDING') {
        throw new ConflictError('Only pending or approved withdrawals can be completed');
      }

      // Completing directly from PENDING requires a verified on-chain payout
      if (withdrawal.status === 'PENDING' && !txHash) {
        throw new ConflictError('A payout transaction hash is required to complete a pending withdrawal');
      }

      let payout = null;
      if (txHash) {
        if (!withdrawal.destinationAddress) {
          throw new ConflictError('Withdrawal has no destination address to verify against');
        }
        payout = await this.verifyPayoutTx(txHash, withdrawal.destinationAddress, withdrawal.netAmount);
      }

      // If still pending, settle the locked funds like an approval does
      if (withdrawal.status === 'PENDING') {
        if (withdrawal.kind !== 'PRINCIPAL') {
          await walletService.settleLockedTx(tx, withdrawal.userId, toDecimal(withdrawal.amount));
        }
        await tx.walletTransaction.updateMany({
          where: { referenceType: 'WITHDRAWAL', referenceId: withdrawalId },
          data: { status: 'COMPLETED', description: 'Withdrawal paid on-chain' },
        });
      }

      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          processedAt: withdrawal.processedAt ?? new Date(),
          approvedBy: withdrawal.approvedBy ?? adminId,
          payoutTxHash: txHash || undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_COMPLETE_WITHDRAWAL',
          targetType: 'WITHDRAWAL',
          targetId: withdrawalId,
          targetUserId: withdrawal.userId,
          ipAddress,
          metadata: {
            amount: withdrawal.amount,
            payoutTxHash: txHash,
            payoutFrom: payout?.from,
            destinationAddress: withdrawal.destinationAddress,
          },
        },
      });

      logger.info(`Withdrawal completed: ID ${withdrawalId}, Admin ${adminId}`);

      return updatedWithdrawal;
    });
  }

  async getAllWithdrawals(page = 1, limit = 10, status = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (status) {
      where.status = status;
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
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
              mobile: true,
            },
          },
        },
      }),
      prisma.withdrawal.count({ where }),
    ]);

    return {
      withdrawals,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getWithdrawalByIdAdmin(withdrawalId) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        user: {
          select: { id: true, name: true, email: true, mobile: true },
        },
        investment: {
          select: { id: true, amount: true, principal: true, startedAt: true, status: true },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundError('Withdrawal not found');
    }

    return withdrawal;
  }

  async getMinWithdrawal() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'MIN_WITHDRAWAL' },
    });

    return setting ? setting.value : '10';
  }

  async getWithdrawalFeePercent() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'WITHDRAWAL_FEE_PERCENT' },
    });

    return setting ? setting.value : '5';
  }

  async getEarlyPrincipalPenaltyPercent() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'EARLY_PRINCIPAL_PENALTY_PERCENT' },
    });

    return setting ? setting.value : '10';
  }
}
