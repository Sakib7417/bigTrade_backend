import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError } from '../../middleware/error.middleware.js';
import { toDecimal } from '../../utils/money.js';
import logger from '../../config/logger.js';

export class WalletService {
  async getWallet(userId) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    return wallet;
  }

  // Locks the wallet row (SELECT ... FOR UPDATE). Must be called inside a
  // transaction so concurrent balance mutations are serialized.
  async lockWalletRow(tx, userId) {
    const rows = await tx.$queryRaw`SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;

    if (!rows.length) {
      const wallet = await tx.wallet.create({
        data: { userId, availableBalance: 0, lockedBalance: 0 },
      });
      return wallet;
    }

    return rows[0];
  }

  // Transaction-aware credit - call inside prisma.$transaction
  async creditTx(tx, userId, amount, type, referenceType, referenceId, description = null, metadata = null, idempotencyKey = null) {
    const value = toDecimal(amount);

    if (idempotencyKey) {
      const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return { wallet: await tx.wallet.findUnique({ where: { userId } }), transaction: existing, duplicate: true };
      }
    }

    const wallet = await this.lockWalletRow(tx, userId);

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: value } },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        amount: value,
        currency: 'USD',
        direction: 'CREDIT',
        referenceType,
        referenceId,
        status: 'COMPLETED',
        description,
        metadata,
        idempotencyKey,
      },
    });

    return { wallet: updatedWallet, transaction };
  }

  // Transaction-aware debit - call inside prisma.$transaction
  async debitTx(tx, userId, amount, type, referenceType, referenceId, description = null, metadata = null, idempotencyKey = null) {
    const value = toDecimal(amount);

    if (idempotencyKey) {
      const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return { wallet: await tx.wallet.findUnique({ where: { userId } }), transaction: existing, duplicate: true };
      }
    }

    const wallet = await this.lockWalletRow(tx, userId);
    const available = toDecimal(wallet.availableBalance ?? wallet.available_balance);

    if (available.lt(value)) {
      throw new ConflictError('Insufficient balance');
    }

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { decrement: value } },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        amount: value,
        currency: 'USD',
        direction: 'DEBIT',
        referenceType,
        referenceId,
        status: 'COMPLETED',
        description,
        metadata,
        idempotencyKey,
      },
    });

    return { wallet: updatedWallet, transaction };
  }

  // Move funds from available to locked (must run inside a transaction)
  async lockFundsTx(tx, userId, amount) {
    const value = toDecimal(amount);
    const wallet = await this.lockWalletRow(tx, userId);
    const available = toDecimal(wallet.availableBalance ?? wallet.available_balance);

    if (available.lt(value)) {
      throw new ConflictError('Insufficient balance');
    }

    return tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { decrement: value },
        lockedBalance: { increment: value },
      },
    });
  }

  // Move funds from locked back to available (must run inside a transaction)
  async unlockFundsTx(tx, userId, amount) {
    const value = toDecimal(amount);
    const wallet = await this.lockWalletRow(tx, userId);
    const locked = toDecimal(wallet.lockedBalance ?? wallet.locked_balance);

    if (locked.lt(value)) {
      throw new ConflictError('Insufficient locked balance');
    }

    return tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { increment: value },
        lockedBalance: { decrement: value },
      },
    });
  }

  // Permanently remove funds from locked balance (must run inside a transaction)
  async settleLockedTx(tx, userId, amount) {
    const value = toDecimal(amount);
    const wallet = await this.lockWalletRow(tx, userId);
    const locked = toDecimal(wallet.lockedBalance ?? wallet.locked_balance);

    if (locked.lt(value)) {
      throw new ConflictError('Insufficient locked balance');
    }

    return tx.wallet.update({
      where: { id: wallet.id },
      data: { lockedBalance: { decrement: value } },
    });
  }

  // Standalone wrappers (self-contained transactions)
  async credit(userId, amount, type, referenceType, referenceId, description = null, metadata = null, idempotencyKey = null) {
    return prisma.$transaction(async (tx) => {
      const result = await this.creditTx(tx, userId, amount, type, referenceType, referenceId, description, metadata, idempotencyKey);
      logger.info(`Wallet credited: User ${userId}, Amount ${amount}, Type ${type}`);
      return result;
    });
  }

  async debit(userId, amount, type, referenceType, referenceId, description = null, metadata = null, idempotencyKey = null) {
    return prisma.$transaction(async (tx) => {
      const result = await this.debitTx(tx, userId, amount, type, referenceType, referenceId, description, metadata, idempotencyKey);
      logger.info(`Wallet debited: User ${userId}, Amount ${amount}, Type ${type}`);
      return result;
    });
  }

  async lock(userId, amount, referenceType, referenceId) {
    return prisma.$transaction(async (tx) => {
      const wallet = await this.lockFundsTx(tx, userId, amount);
      logger.info(`Funds locked: User ${userId}, Amount ${amount}`);
      return wallet;
    });
  }

  async unlock(userId, amount, referenceType, referenceId) {
    return prisma.$transaction(async (tx) => {
      const wallet = await this.unlockFundsTx(tx, userId, amount);
      logger.info(`Funds unlocked: User ${userId}, Amount ${amount}`);
      return wallet;
    });
  }

  async getTransactions(userId, page = 1, limit = 10, type = null) {
    const skip = (page - 1) * limit;

    const where = { userId };
    if (type) {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    return {
      transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminAdjustment(userId, amount, reason, adminId, idempotencyKey = null) {
    return await prisma.$transaction(async (tx) => {
      const value = toDecimal(amount);

      if (idempotencyKey) {
        const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) {
          return { transaction: existing, duplicate: true };
        }
      }

      const wallet = await this.lockWalletRow(tx, userId);

      const isCredit = value.gt(0);
      const adjustedAmount = value.abs();

      if (!isCredit) {
        const available = toDecimal(wallet.availableBalance ?? wallet.available_balance);
        if (available.lt(adjustedAmount)) {
          throw new ConflictError('Insufficient balance for debit adjustment');
        }
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: isCredit
            ? { increment: adjustedAmount }
            : { decrement: adjustedAmount },
        },
      });

      // Create transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'ADMIN_ADJUSTMENT',
          amount: adjustedAmount,
          currency: 'USD',
          direction: isCredit ? 'CREDIT' : 'DEBIT',
          status: 'COMPLETED',
          description: reason,
          metadata: { adminId },
          idempotencyKey,
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_WALLET_ADJUSTMENT',
          targetType: 'WALLET',
          targetId: wallet.id,
          targetUserId: userId,
          metadata: {
            amount: adjustedAmount,
            direction: isCredit ? 'CREDIT' : 'DEBIT',
            reason,
          },
        },
      });

      logger.info(`Admin wallet adjustment: User ${userId}, Amount ${adjustedAmount}, Admin ${adminId}`);

      return { wallet: updatedWallet, transaction };
    });
  }
}
