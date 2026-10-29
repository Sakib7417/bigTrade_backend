import { ethers } from 'ethers';
import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import { InvestmentService } from '../investments/investment.service.js';
import { toDecimal, roundMoney } from '../../utils/money.js';
import { getProvider, ERC20_TRANSFER_ABI } from '../../config/blockchain.js';
import { autoClaimAvailable, signClaimVoucher, verifyBep20Payout } from '../../utils/payout.js';
import { kycService } from '../kyc/kyc.service.js';
import { userService } from '../users/user.service.js';
import { verifyTronPayout, isTronAddress, tronUsdtBalance, tronToHex } from '../../utils/tron.js';
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

  // BEP20 (0x…) vs TRC20 (T…) — decides which payout vault the claim targets
  detectNetwork(destinationAddress) {
    if (!destinationAddress) {
      throw new ConflictError('A destination wallet address is required');
    }
    if (isTronAddress(destinationAddress)) return 'TRC20';
    if (ethers.isAddress(destinationAddress)) return 'BEP20';
    throw new ConflictError('Invalid destination address (BEP20 0x… or TRC20 T…)');
  }

  // Post-commit: sign a claim voucher for a PENDING withdrawal and mark it
  // PROCESSING. If signing fails the withdrawal stays PENDING for admin payout.
  async tryIssueVoucher(withdrawalId) {
    const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w || w.status !== 'PENDING') return null;

    let network;
    try {
      network = this.detectNetwork(w.destinationAddress);
    } catch {
      return null;
    }
    if (!autoClaimAvailable(network, w.netAmount)) return null;

    try {
      const claim = await signClaimVoucher(network, w.destinationAddress, w.netAmount);
      const withdrawal = await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'PROCESSING',
          network,
          claimNonce: claim.nonce,
          claimSignature: claim.signature,
          claimExpiry: new Date(claim.expiry * 1000),
          claimContract: claim.contract,
          claimAmountRaw: claim.amountRaw,
          claimIssuedAt: new Date(),
        },
      });
      logger.info(`Claim voucher issued: withdrawal ${withdrawalId} on ${network}`);
      return { withdrawal, claim };
    } catch (error) {
      logger.warn(`Claim voucher signing skipped for ${withdrawalId}: ${error.message}`);
      return null;
    }
  }

  async createWithdrawal(userId, amount, destinationAddress, bankDetails, idempotencyKey = null, withdrawalPassword = null) {
    const value = toDecimal(amount);
    const network = this.detectNetwork(destinationAddress);
    await kycService.requireApproved(userId);
    await userService.assertWithdrawalReady(userId, withdrawalPassword);

    const result = await prisma.$transaction(async (tx) => {
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
          network,
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

    if (!result.duplicate) {
      const issued = await this.tryIssueVoucher(result.withdrawal.id);
      if (issued) {
        result.withdrawal = issued.withdrawal;
        result.claim = issued.claim;
      }
    }
    return result;
  }

  // Principal withdrawal: age-based capital deduction (10%→0% over 150 days)
  async createPrincipalWithdrawal(userId, investmentId, destinationAddress, bankDetails, idempotencyKey = null, requestedAmount = null, withdrawalPassword = null) {
    await kycService.requireApproved(userId);
    await userService.assertWithdrawalReady(userId, withdrawalPassword);
    const result = await prisma.$transaction(async (tx) => {
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

      // Open withdrawals still hold an allocation — completed ones already
      // shrank the investment principal, so counting them would double-charge.
      const existingPrincipalWithdrawals = await tx.withdrawal.findMany({
        where: {
          investmentId,
          kind: 'PRINCIPAL',
          status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] },
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

      // Custom amount (post-penalty units) — blank means "withdraw everything".
      const requested = requestedAmount != null ? toDecimal(requestedAmount) : withdrawable;
      if (requested.lte(0)) {
        throw new ConflictError('Enter a valid amount');
      }
      if (requested.gt(withdrawable)) {
        throw new ConflictError(`Only $${withdrawable} is available to withdraw`);
      }
      if (requested.lt(withdrawable) && requested.lt(10)) {
        throw new ConflictError('Minimum partial withdrawal is $10');
      }

      const isFull = requested.gte(withdrawable);

      const wallet = await walletService.lockWalletRow(tx, userId);

      const feePercent = toDecimal(await this.getWithdrawalFeePercent());
      const fee = roundMoney(requested.mul(feePercent).div(100));
      const netAmount = requested.sub(fee);

      // Gross principal this payout will consume (deduction is proportional).
      // The investment is only adjusted when the withdrawal COMPLETES —
      // shrinking it here would corrupt eligibility for the remainder.
      const proportionalPenalty = (isFull
        ? toDecimal(investment.principal)
        : roundMoney(requested.mul(100).div(toDecimal(100).sub(eligibility.penaltyPercent)))
      ).sub(requested);

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          kind: 'PRINCIPAL',
          amount: requested,
          fee,
          netAmount,
          principalPenalty: proportionalPenalty,
          investmentId,
          status: 'PENDING',
          destinationAddress,
          bankDetails,
          network: this.detectNetwork(destinationAddress),
          idempotencyKey,
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: requested,
          currency: 'USD',
          direction: 'DEBIT',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          status: 'PENDING',
          description: `Principal withdrawal for investment ${investmentId}`,
          metadata: {
            investmentId,
            early: eligibility.isEarly,
            principalPenalty: proportionalPenalty,
            partial: !isFull,
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
        `Principal withdrawal created: User ${userId}, Investment ${investmentId}, Amount ${requested}, Early: ${eligibility.isEarly}`
      );

      return { withdrawal, duplicate: false, eligibility };
    });

    if (!result.duplicate) {
      const issued = await this.tryIssueVoucher(result.withdrawal.id);
      if (issued) {
        result.withdrawal = issued.withdrawal;
        result.claim = issued.claim;
      }
    }
    return result;
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
        // Only in-flight requests reserve principal — completed ones already
        // reduced investment.principal at settlement.
        status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] },
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

  // User-submitted claim tx: verify the vault paid out on-chain, then settle.
  async confirmClaim(withdrawalId, userId, txHash) {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });

    if (!withdrawal) {
      throw new NotFoundError('Withdrawal not found');
    }
    if (withdrawal.userId !== userId) {
      throw new ConflictError('Not authorized to confirm this withdrawal');
    }
    // Idempotent replay
    if (withdrawal.status === 'COMPLETED' && withdrawal.payoutTxHash === txHash) {
      return withdrawal;
    }
    if (withdrawal.status !== 'PROCESSING' || !withdrawal.claimSignature) {
      throw new ConflictError('No active claim voucher for this withdrawal');
    }
    // No hash → auto-detect: scan the payout contract's recent txs for a
    // payout to this user. Lets the UI auto-verify a claim that already landed.
    if (!txHash) {
      txHash = await this.findClaimTx(withdrawal);
      if (!txHash) {
        throw new ConflictError('Claim transaction not found on-chain yet — wait a few seconds and retry');
      }
    }
    const used = await prisma.withdrawal.findUnique({ where: { payoutTxHash: txHash } });
    if (used) {
      throw new ConflictError('This transaction hash was already used for another withdrawal');
    }

    const verify =
      withdrawal.network === 'TRC20'
        ? await verifyTronPayout(
            txHash,
            withdrawal.claimContract,
            withdrawal.destinationAddress,
            withdrawal.claimAmountRaw
          )
        : await verifyBep20Payout(
            txHash,
            withdrawal.claimContract,
            withdrawal.destinationAddress,
            withdrawal.claimAmountRaw
          );

    if (!verify.found) {
      throw new ConflictError('Claim transaction not found on-chain yet — wait a few seconds and retry');
    }
    if (verify.failed) {
      throw new ConflictError('Claim transaction failed on-chain — funds were not paid out');
    }
    if (verify.notPayout) {
      throw new ConflictError('Transaction is not a vault payout to the withdrawal address');
    }

    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE`;
      const locked = rows[0];
      if (!locked || locked.status !== 'PROCESSING') {
        throw new ConflictError('Withdrawal status changed — retry');
      }

      if (locked.kind !== 'PRINCIPAL') {
        await walletService.settleLockedTx(tx, locked.userId, toDecimal(locked.amount));
      }

      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'COMPLETED',
          payoutTxHash: txHash,
          completedAt: new Date(),
          processedAt: locked.processedAt ?? new Date(),
        },
      });

      await tx.walletTransaction.updateMany({
        where: { referenceType: 'WITHDRAWAL', referenceId: withdrawalId },
        data: { status: 'COMPLETED', description: 'Paid via smart-contract claim' },
      });

      await this.consumePrincipalTx(tx, locked);

      logger.info(`Withdrawal completed via claim: ${withdrawalId}, tx ${txHash}`);
      return updated;
    });
  }

  // Once a PRINCIPAL withdrawal is actually paid, shrink the investment by the
  // gross principal consumed (amount + proportional deduction). Reaching zero
  // closes the investment — ROI then accrues only on remaining capital.
  async consumePrincipalTx(tx, withdrawal) {
    if (withdrawal.kind !== 'PRINCIPAL' || !withdrawal.investmentId) return;
    const gross = toDecimal(withdrawal.amount).add(toDecimal(withdrawal.principalPenalty || 0));
    if (gross.lte(0)) return;

    const inv = await tx.investment.findUnique({
      where: { id: withdrawal.investmentId },
      select: { principal: true, totalRoiEarned: true },
    });
    if (!inv) return;

    const remaining = toDecimal(inv.principal).sub(gross);
    if (remaining.lte(0.005)) {
      await tx.investment.update({
        where: { id: withdrawal.investmentId },
        data: { principal: 0, amount: 0, status: 'COMPLETED' },
      });
      return;
    }

    // Cap tracks principal × multiplier — shrink it with the principal so a
    // withdrawal can't leave behind a large earning allowance. Never drop it
    // below what was already earned (paid income stays accounted).
    const capMultiplier = await investmentService.getEarningCapMultiplier(tx);
    let newCap = remaining.mul(capMultiplier);
    if (newCap.lt(toDecimal(inv.totalRoiEarned))) {
      newCap = toDecimal(inv.totalRoiEarned);
    }

    // Below the platform minimum it can't earn ROI — mark it right away
    // instead of waiting for the daily job to flip it.
    const minInvestment = await investmentService.getMinInvestment();
    await tx.investment.update({
      where: { id: withdrawal.investmentId },
      data: {
        principal: remaining,
        amount: { decrement: gross },
        earningCap: newCap,
        ...(remaining.lt(minInvestment) ? { status: 'INACTIVE' } : {}),
      },
    });
  }

  // Scan the payout vault's recent transactions for a payout to this
  // destination covering the voucher amount — used when the user submits no
  // hash (UI auto-verify) or their claim settled before the wallet reported it.
  async findClaimTx(w) {
    try {
      if (w.network === 'TRC20') {
        const res = await fetch(
          `${config.tron.rpcUrl}/v1/contracts/${tronToHex(w.claimContract)}/transactions?limit=20&order_by=block_timestamp,desc`,
          { signal: AbortSignal.timeout(15000) }
        );
        const { data } = await res.json();
        for (const t of data ?? []) {
          if (t.ret?.[0]?.contractRet !== 'SUCCESS') continue;
          if (await prisma.withdrawal.findUnique({ where: { payoutTxHash: t.txID } })) continue;
          const v = await verifyTronPayout(
            t.txID, w.claimContract, w.destinationAddress, w.claimAmountRaw
          ).catch(() => null);
          if (v?.found && !v.failed && !v.notPayout) return t.txID;
        }
        return null;
      }

      const provider = getProvider();
      const latest = await provider.getBlockNumber();
      const logs = await provider.getLogs({
        address: config.blockchain.usdtContract,
        topics: [
          ethers.id('Transfer(address,address,uint256)'),
          ethers.zeroPadValue(w.claimContract, 32),
          ethers.zeroPadValue(w.destinationAddress, 32),
        ],
        fromBlock: Math.max(0, latest - 20000),
        toBlock: latest,
      });
      for (let i = logs.length - 1; i >= 0; i--) {
        const txHash = logs[i].transactionHash;
        if (await prisma.withdrawal.findUnique({ where: { payoutTxHash: txHash } })) continue;
        const v = await verifyBep20Payout(
          txHash, w.claimContract, w.destinationAddress, w.claimAmountRaw
        ).catch(() => null);
        if (v?.found) return txHash;
      }
      return null;
    } catch (error) {
      logger.warn(`Claim auto-detect failed for ${w.id}: ${error.message}`);
      return null;
    }
  }

  // Re-sign a voucher after the previous one expired (contract rejects expired
  // vouchers, so the old signature is dead weight anyway).
  async reissueVoucher(withdrawalId, userId) {
    const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });

    if (!w) {
      throw new NotFoundError('Withdrawal not found');
    }
    if (w.userId !== userId) {
      throw new ConflictError('Not authorized to reissue this voucher');
    }
    if (w.status !== 'PROCESSING' || !w.claimSignature) {
      throw new ConflictError('This withdrawal has no claim voucher to reissue');
    }
    if (w.claimExpiry && new Date(w.claimExpiry) > new Date()) {
      throw new ConflictError('Voucher is still valid — claim it before it expires');
    }

    const claim = await signClaimVoucher(w.network, w.destinationAddress, w.netAmount);
    const withdrawal = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        claimNonce: claim.nonce,
        claimSignature: claim.signature,
        claimExpiry: new Date(claim.expiry * 1000),
        claimContract: claim.contract,
        claimAmountRaw: claim.amountRaw,
        claimIssuedAt: new Date(),
      },
    });

    return { withdrawal, claim };
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

      // A live voucher could still be claimed on-chain — manual settlement now
      // would pay the user twice. Wait for expiry (or user claim) first.
      if (withdrawal.claimSignature && withdrawal.claimExpiry && new Date(withdrawal.claimExpiry) > new Date()) {
        throw new ConflictError('An active claim voucher exists — let the user claim or wait for it to expire');
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

      if (withdrawal.claimSignature && withdrawal.claimExpiry && new Date(withdrawal.claimExpiry) > new Date()) {
        throw new ConflictError('An active claim voucher exists — let the user claim or wait for it to expire');
      }

      if (withdrawal.kind === 'PRINCIPAL') {
        // Legacy requests closed the investment at creation — reactivate it.
        // New requests never touch the investment until payout, so this is a no-op.
        if (withdrawal.investmentId) {
          await tx.investment.updateMany({
            where: { id: withdrawal.investmentId, status: 'COMPLETED' },
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

      await this.consumePrincipalTx(tx, withdrawal);

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

  // On-chain payout vault balances (admin panel)
  async getTreasuryStatus() {
    const out = {
      autoClaimEnabled: config.payout.autoClaimEnabled,
      autoClaimMaxUsd: config.payout.autoClaimMaxUsd,
      vaults: [],
    };

    if (config.payout.contractBep20) {
      let balanceUsdt = null;
      try {
        const usdt = new ethers.Contract(
          config.blockchain.usdtContract,
          ['function balanceOf(address) view returns (uint256)'],
          getProvider()
        );
        balanceUsdt = ethers.formatUnits(
          await usdt.balanceOf(config.payout.contractBep20),
          config.blockchain.usdtDecimals
        );
      } catch (error) {
        logger.warn(`BEP20 vault balance read failed: ${error.message}`);
      }
      out.vaults.push({ network: 'BEP20', contract: config.payout.contractBep20, balanceUsdt });
    }

    if (config.payout.contractTrc20) {
      let balanceUsdt = null;
      try {
        const raw = await tronUsdtBalance(config.payout.contractTrc20);
        balanceUsdt = toDecimal(raw.toString()).div(10 ** config.tron.usdtDecimals).toFixed(2);
      } catch (error) {
        logger.warn(`TRC20 vault balance read failed: ${error.message}`);
      }
      out.vaults.push({ network: 'TRC20', contract: config.payout.contractTrc20, balanceUsdt });
    }

    return out;
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
