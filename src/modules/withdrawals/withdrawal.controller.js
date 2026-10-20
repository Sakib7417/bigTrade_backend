import { WithdrawalService } from './withdrawal.service.js';
import logger from '../../config/logger.js';

const withdrawalService = new WithdrawalService();

export class WithdrawalController {
  async createWithdrawal(req, res, next) {
    try {
      const { amount, destinationAddress, bankDetails, idempotencyKey } = req.body;
      const result = await withdrawalService.createWithdrawal(
        req.user.id,
        amount,
        destinationAddress,
        bankDetails,
        idempotencyKey
      );

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Withdrawal request already exists'
          : 'Withdrawal request created successfully',
        data: { withdrawal: result.withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  async createPrincipalWithdrawal(req, res, next) {
    try {
      const { investmentId, destinationAddress, bankDetails, idempotencyKey } = req.body;
      const result = await withdrawalService.createPrincipalWithdrawal(
        req.user.id,
        investmentId,
        destinationAddress,
        bankDetails,
        idempotencyKey
      );

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Principal withdrawal request already exists'
          : 'Principal withdrawal request created successfully',
        data: {
          withdrawal: result.withdrawal,
          eligibility: result.eligibility,
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
}

export const withdrawalController = new WithdrawalController();
