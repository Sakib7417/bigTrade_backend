import { ReferralService } from './referral.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import logger from '../../config/logger.js';

const referralService = new ReferralService();
const commissionService = new CommissionService();

export class ReferralController {
  async getReferralTree(req, res, next) {
    try {
      const tree = await referralService.getReferralTree(req.user.id);

      res.status(200).json({
        success: true,
        data: { tree },
      });
    } catch (error) {
      next(error);
    }
  }

  async getDirectReferrals(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await referralService.getDirectReferrals(
        req.user.id,
        parseInt(page) || 1,
        parseInt(limit) || 10
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getReferralsByLevel(req, res, next) {
    try {
      const { level } = req.params;
      const { page, limit } = req.query;
      const result = await referralService.getReferralsByLevel(
        req.user.id,
        parseInt(level),
        parseInt(page) || 1,
        parseInt(limit) || 10
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getCommissions(req, res, next) {
    try {
      const { page, limit, type } = req.query;
      const result = await commissionService.getCommissions(
        req.user.id,
        parseInt(page) || 1,
        parseInt(limit) || 10,
        type
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getCommissionStats(req, res, next) {
    try {
      const stats = await commissionService.getCommissionStats(req.user.id);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  async getReferralStats(req, res, next) {
    try {
      const stats = await referralService.getReferralStats(req.user.id);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const referralController = new ReferralController();
