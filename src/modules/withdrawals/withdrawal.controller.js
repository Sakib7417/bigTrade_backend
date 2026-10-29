import { WithdrawalService } from './withdrawal.service.js';
import logger from '../../config/logger.js';

const withdrawalService = new WithdrawalService();

export class WithdrawalController {
  async createWithdrawal(req, res, next) {
    try {
      const { amount, destinationAddress, bankDetails, idempotencyKey, withdrawalPassword } = req.body;
      const result = await withdrawalService.createWithdrawal(
        req.user.id,
        amount,
        destinationAddress,
        bankDetails,
        idempotencyKey,
        withdrawalPassword
      );

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Withdrawal request already exists'
          : 'Withdrawal request created successfully',
        data: { withdrawal: result.withdrawal, claim: result.claim ?? null },
      });
    } catch (error) {
      next(error);
    }
  }

  async createPrincipalWithdrawal(req, res, next) {
    try {
      const { investmentId, amount, destinationAddress, bankDetails, idempotencyKey, withdrawalPassword } = req.body;
      const result = await withdrawalService.createPrincipalWithdrawal(
        req.user.id,
        investmentId,
        destinationAddress,
        bankDetails,
        idempotencyKey,
        amount,
        withdrawalPassword
      );

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Principal withdrawal request already exists'
          : 'Principal withdrawal request created successfully',
        data: {
          withdrawal: result.withdrawal,
          eligibility: result.eligibility,
          claim: result.claim ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getPrincipalEligibility(req, res, next) {
    try {
      const { investmentId } = req.params;
      const result = await withdrawalService.getPrincipalEligibility(
        req.user.id,
        investmentId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getWithdrawals(req, res, next) {
    try {
      const { page, limit, status } = req.query;
      const result = await withdrawalService.getWithdrawals(
        req.user.id,
        parseInt(page) || 1,
        parseInt(limit) || 10,
        status
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getWithdrawalById(req, res, next) {
    try {
      const { id } = req.params;
      const withdrawal = await withdrawalService.getWithdrawalById(id, req.user.id);

      res.status(200).json({
        success: true,
        data: { withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  // Submit the on-chain claim() transaction hash → verify payout → complete.
  async confirmClaim(req, res, next) {
    try {
      const { id } = req.params;
      const { txHash } = req.body;
      const withdrawal = await withdrawalService.confirmClaim(id, req.user.id, txHash);

      res.status(200).json({
        success: true,
        message: 'Withdrawal paid out on-chain',
        data: { withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  // Re-sign an expired voucher (old signature is void on-chain anyway).
  async reissueVoucher(req, res, next) {
    try {
      const { id } = req.params;
      const result = await withdrawalService.reissueVoucher(id, req.user.id);

      res.status(200).json({
        success: true,
        message: 'New claim voucher issued',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const withdrawalController = new WithdrawalController();
