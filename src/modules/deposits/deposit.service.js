import { ethers } from 'ethers';
import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { rewardService } from '../rewards/reward.service.js';
import { getProvider, ERC20_TRANSFER_ABI } from '../../config/blockchain.js';
import { toDecimal } from '../../utils/money.js';
import { verifyTronUsdtTransfer, tronHexToBase58, isTronAddress } from '../../utils/tron.js';
import config from '../../config/env.js';
import logger from '../../config/logger.js';

export const DEPOSIT_NETWORKS = ['BEP20', 'TRC20'];

const walletService = new WalletService();
const commissionService = new CommissionService();
const transferIface = new ethers.Interface(ERC20_TRANSFER_ABI);

export class DepositService {
  // Deposit wallet is admin-configurable via SystemSetting; env is fallback
  async getMinInvestment(tx = prisma) {
    const setting = await tx.systemSetting.findUnique({ where: { key: 'MIN_INVESTMENT' } });
    return toDecimal(setting?.value ?? '100');
  }

  async getEarningCapMultiplier(tx = prisma) {
    const setting = await tx.systemSetting.findUnique({ where: { key: 'EARNING_CAP_MULTIPLIER' } });
    return toDecimal(setting?.value ?? '10');
  }

  // Legacy single wallet — kept as fallback when the BEP20 pool is empty
  async getDepositWallet() {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'PLATFORM_DEPOSIT_WALLET' },
    });
    const raw = setting?.value || config.blockchain.depositWallet;
    if (!raw) return null;
    try {
      return ethers.getAddress(raw.toLowerCase());
    } catch {
      return raw;
    }
  }

  // Active platform wallets for a network. BEP20 falls back to the legacy
  // single-wallet setting when the pool is empty.
  async getDepositWallets(network, tx = prisma) {
    const rows = await tx.depositWallet.findMany({
      where: { network, active: true },
      select: { address: true },
    });
    const list = rows.map((r) => r.address);
    if (network === 'BEP20' && list.length === 0) {
      const legacy = await this.getDepositWallet();
      if (legacy) list.push(legacy);
    }
    return list;
  }

  // Submit a USDT transfer txHash; verify on-chain and credit the wallet once
  // the required confirmations are reached. Fully idempotent on txHash.
  async submitCryptoDeposit(userId, rawHash, network = 'BEP20') {
    network = String(network || 'BEP20').toUpperCase();
    if (!DEPOSIT_NETWORKS.includes(network)) {
      throw new ValidationError('Unsupported network — use BEP20 or TRC20');
    }

    const txHash = String(rawHash || '').trim().replace(/^0x/i, network === 'TRC20' ? '' : '0x');
    const hashOk =
      network === 'TRC20'
        ? /^[0-9a-fA-F]{64}$/.test(txHash)
        : /^0x[0-9a-fA-F]{64}$/.test(txHash);
    if (!hashOk) {
      throw new ValidationError('Invalid transaction hash for this network');
    }

    const wallets = await this.getDepositWallets(network);
    const chainReady =
      network === 'TRC20'
        ? Boolean(config.tron.usdtContract && config.tron.rpcUrl)
        : Boolean(config.blockchain.usdtContract && config.blockchain.rpcUrl);

    if (wallets.length === 0 || !chainReady) {
      throw new ConflictError(`Crypto deposits are not configured for ${network}`);
    }

    // Idempotent replay: return existing deposit if already recorded
    const lookup = network === 'TRC20' ? `trc20:${txHash}` : txHash;
    const existing = await prisma.cryptoDeposit.findFirst({
      where: { txHash: lookup },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictError('This transaction was already submitted by another account');
      }
      if (existing.status === 'CREDITED') {
        return { deposit: existing, duplicate: true };
      }
      // PENDING -> re-verify (may now have enough confirmations)
      return this.verifyAndCredit(existing.id);
    }

    let parsed;
    if (network === 'TRC20') {
      parsed = await this.verifyTronTx(txHash, wallets);
    } else {
      parsed = await this.verifyBscTx(txHash, wallets);
    }

    const requiredConfirmations =
      network === 'TRC20' ? config.tron.requiredConfirmations : config.blockchain.requiredConfirmations;

    const deposit = await prisma.cryptoDeposit.create({
      data: {
        userId,
        txHash: lookup,
        fromAddress: parsed.fromAddress,
        toAddress: parsed.toAddress,
        amount: toDecimal(parsed.amount),
        asset: 'USDT',
        network,
        confirmations: parsed.confirmations,
        status: parsed.confirmations >= requiredConfirmations ? 'CONFIRMED' : 'PENDING',
      },
    });

    if (deposit.status === 'CONFIRMED') {
      return this.verifyAndCredit(deposit.id);
    }

    logger.info(
      `Crypto deposit pending confirmations: ${txHash} (${parsed.confirmations}/${requiredConfirmations}) [${network}]`
    );

    return { deposit, duplicate: false };
  }

  // BEP20: find a USDT Transfer log addressed to any configured platform wallet
  async verifyBscTx(txHash, wallets) {
    const { usdtContract, usdtDecimals } = config.blockchain;
    const walletSet = new Set(wallets.map((w) => w.toLowerCase()));

    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);

    if (!receipt || receipt.status !== 1) {
      throw new NotFoundError('Transaction not found or failed on-chain');
    }

    const transfer = receipt.logs
      .filter((log) => log.address.toLowerCase() === usdtContract.toLowerCase())
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
          walletSet.has(parsed.args.to.toLowerCase())
      );

    if (!transfer) {
      throw new ConflictError('Transaction is not a USDT transfer to a platform wallet');
    }

    const latestBlock = await provider.getBlockNumber();
    return {
      fromAddress: transfer.args.from,
      toAddress: transfer.args.to,
      amount: ethers.formatUnits(transfer.args.value, usdtDecimals),
      confirmations: Math.max(0, latestBlock - receipt.blockNumber + 1),
    };
  }

  // TRC20: TronGrid verification against the platform wallet pool
  async verifyTronTx(txHash, wallets) {
    const res = await verifyTronUsdtTransfer(txHash, wallets).catch((err) => {
      logger.error(`Tron verification error for ${txHash}: ${err.message}`);
      return { found: false };
    });

    if (!res.found) throw new NotFoundError('Transaction not found on Tron network');
    if (res.failed) throw new ConflictError('Transaction failed on-chain');
    if (res.notPlatform) {
      throw new ConflictError('Transaction is not a USDT transfer to a platform wallet');
    }

    return {
      fromAddress: tronHexToBase58(res.matched.fromHex),
      toAddress: tronHexToBase58(res.matched.toHex),
      amount: ethers.formatUnits(res.matched.amount, config.tron.usdtDecimals),
      confirmations: res.confirmations,
    };
  }

  // Re-verify a stored deposit and credit the wallet when confirmed.
  async verifyAndCredit(depositId) {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "CryptoDeposit" WHERE id = ${depositId} FOR UPDATE`;
      const deposit = rows[0];

      if (!deposit) {
        throw new NotFoundError('Deposit not found');
      }

      if (deposit.status === 'CREDITED') {
        return { deposit, duplicate: true };
      }

      const requiredConfirmations =
        deposit.network === 'TRC20' ? config.tron.requiredConfirmations : config.blockchain.requiredConfirmations;

      let confirmations;
      if (deposit.network === 'TRC20') {
        const rawHash = deposit.txHash.replace(/^trc20:/, '');
        const wallets = await this.getDepositWallets('TRC20', tx);
        const res = await verifyTronUsdtTransfer(rawHash, wallets).catch(() => ({ found: false }));
        if (!res.found) throw new NotFoundError('Transaction not found on Tron network');
        if (res.failed) {
          await tx.cryptoDeposit.update({ where: { id: depositId }, data: { status: 'REJECTED' } });
          throw new ConflictError('Transaction failed on-chain');
        }
        confirmations = res.confirmations;
      } else {
        const provider = getProvider();
        const [receipt, latestBlock] = await Promise.all([
          provider.getTransactionReceipt(deposit.txHash),
          provider.getBlockNumber(),
        ]);

        if (!receipt || receipt.status !== 1) {
          await tx.cryptoDeposit.update({
            where: { id: depositId },
            data: { status: 'REJECTED' },
          });
          throw new ConflictError('Transaction failed on-chain');
        }

        confirmations = Math.max(0, latestBlock - receipt.blockNumber + 1);
      }

      if (confirmations < requiredConfirmations) {
        const updated = await tx.cryptoDeposit.update({
          where: { id: depositId },
          data: { confirmations },
        });
        return { deposit: updated, duplicate: false, awaitingConfirmations: true };
      }

      // Credit wallet — ledger row carries the txHash as idempotency key
      const { transaction } = await walletService.creditTx(
        tx,
        deposit.userId,
        deposit.amount,
        'DEPOSIT',
        'CRYPTO_DEPOSIT',
        deposit.id,
        `USDT deposit (${deposit.network})`,
        { txHash: deposit.txHash, fromAddress: deposit.fromAddress, confirmations },
        `crypto-deposit:${deposit.txHash}`
      );

      const credited = await tx.cryptoDeposit.update({
        where: { id: depositId },
        data: {
          status: 'CREDITED',
          confirmations,
          walletTransactionId: transaction.id,
        },
      });

      logger.info(
        `Crypto deposit credited: User ${deposit.userId}, ${deposit.amount} USDT, tx ${deposit.txHash}`
      );

      // Auto-invest: a deposit >= minimum becomes an investment immediately.
      // Smaller amounts stay as wallet balance for manual invest.
      let investment = null;
      const amount = toDecimal(deposit.amount);
      if (amount.gte(await this.getMinInvestment(tx))) {
        const idemKey = `auto-invest:deposit:${deposit.id}`;
        const capMultiplier = await this.getEarningCapMultiplier(tx);
        const live = await tx.investment.findFirst({
          where: { userId: deposit.userId, status: { in: ['ACTIVE', 'CAPPED', 'INACTIVE'] } },
          orderBy: { createdAt: 'asc' },
        });
        if (live) {
          investment = await tx.investment.update({
            where: { id: live.id },
            data: {
              amount: { increment: amount },
              principal: { increment: amount },
              earningCap: { increment: amount.mul(capMultiplier) },
              status: 'ACTIVE',
            },
          });
          await tx.investmentCycle.create({
            data: {
              investmentId: live.id,
              cycleNumber: (await tx.investmentCycle.count({ where: { investmentId: live.id } })) + 1,
              amount,
              earningCap: amount.mul(capMultiplier),
              status: 'ACTIVE',
            },
          });
        } else {
          investment = await tx.investment.create({
            data: {
              userId: deposit.userId,
              amount,
              principal: amount,
              earningCap: amount.mul(capMultiplier),
              idempotencyKey: idemKey,
            },
          });
        }
        await walletService.debitTx(
          tx,
          deposit.userId,
          amount,
          'INVESTMENT',
          'INVESTMENT',
          investment.id,
          'Auto-invested crypto deposit',
          { depositId: deposit.id, txHash: deposit.txHash },
          `${idemKey}:investment`
        );
        await commissionService.distributeDirectCommission(
          investment.id,
          deposit.userId,
          amount,
          tx
        );
        logger.info(
          `Auto-invested deposit: User ${deposit.userId}, ${amount} USDT, investment ${investment.id}`
        );
      }

      return { deposit: credited, duplicate: false, investment };
    });
 
    // Auto-invest grows uplines' leg volumes — evaluate rank milestones
    if (result.investment) {
      rewardService.evaluateAncestors(result.deposit.userId).catch((err) =>
        logger.error(`Rank reward evaluation failed for ${result.deposit.userId}:`, err)
      );
    }
    return result;
  }

  async getDeposits(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [deposits, total] = await Promise.all([
      prisma.cryptoDeposit.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cryptoDeposit.count({ where: { userId } }),
    ]);

    return {
      deposits,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Returns ONE randomly picked platform wallet for the requested network —
  // the user only ever sees a single address per deposit session.
  async getDepositConfig(network = 'BEP20') {
    network = String(network || 'BEP20').toUpperCase();
    const wallets = await this.getDepositWallets(network);
    const picked = wallets.length ? wallets[Math.floor(Math.random() * wallets.length)] : null;

    const isTron = network === 'TRC20';
    const chain = isTron ? config.tron : config.blockchain;
    const [bep20Wallets, trc20Wallets] = await Promise.all([
      this.getDepositWallets('BEP20'),
      this.getDepositWallets('TRC20'),
    ]);

    return {
      network,
      asset: 'USDT',
      contract: chain.usdtContract ?? null,
      depositWallet: picked,
      requiredConfirmations: chain.requiredConfirmations,
      enabled: Boolean(picked && chain.usdtContract && chain.rpcUrl),
      walletCount: wallets.length,
      availableNetworks: [
        { code: 'BEP20', label: 'BNB Smart Chain (BEP20)', enabled: bep20Wallets.length > 0 },
        { code: 'TRC20', label: 'Tron (TRC20)', enabled: trc20Wallets.length > 0 && Boolean(config.tron.usdtContract) },
      ],
    };
  }

  // Admin: wallet pool management
  async listDepositWallets() {
    const rows = await prisma.depositWallet.findMany({
      where: { active: true },
      orderBy: [{ network: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      BEP20: rows.filter((r) => r.network === 'BEP20'),
      TRC20: rows.filter((r) => r.network === 'TRC20'),
    };
  }

  async addDepositWallet(network, address, adminId) {
    network = String(network || '').toUpperCase();
    if (!DEPOSIT_NETWORKS.includes(network)) {
      throw new ValidationError('Network must be BEP20 or TRC20');
    }
    if (network === 'BEP20') {
      try {
        address = ethers.getAddress(address.trim());
      } catch {
        throw new ValidationError('Invalid BEP20 (0x…) address');
      }
    } else if (!isTronAddress(address.trim())) {
      throw new ValidationError('Invalid TRC20 (T…) address');
    } else {
      address = address.trim();
    }

    // Same network+address can't be duplicated — reactivate a removed one instead
    const existing = await prisma.depositWallet.findUnique({
      where: { network_address: { network, address } },
    });
    const wallet = existing
      ? await prisma.depositWallet.update({ where: { id: existing.id }, data: { active: true } })
      : await prisma.depositWallet.create({ data: { network, address } });
    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'ADMIN_ADD_DEPOSIT_WALLET',
        targetType: 'DEPOSIT_WALLET',
        targetId: wallet.id,
        metadata: { network, address },
      },
    });
    return wallet;
  }

  async removeDepositWallet(id, adminId) {
    const wallet = await prisma.depositWallet.findUnique({ where: { id } });
    if (!wallet) throw new NotFoundError('Wallet not found');
    await prisma.depositWallet.update({ where: { id }, data: { active: false } });
    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'ADMIN_REMOVE_DEPOSIT_WALLET',
        targetType: 'DEPOSIT_WALLET',
        targetId: wallet.id,
        metadata: { network: wallet.network, address: wallet.address },
      },
    });
    return wallet;
  }

  async getAllDeposits(page = 1, limit = 10, status = null) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [deposits, total] = await Promise.all([
      prisma.cryptoDeposit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.cryptoDeposit.count({ where }),
    ]);

    return {
      deposits,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
