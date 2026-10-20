import { InvestmentService } from './investment.service.js';
import logger from '../../config/logger.js';

const investmentService = new InvestmentService();

export class InvestmentController {
  async createInvestment(req, res, next) {
    try {
      const { amount, idempotencyKey } = req.body;
      const result = await investmentService.createInvestment(req.user.id, amount, idempotencyKey);

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Investment already exists'
          : 'Investment created successfully',
        data: { investment: result.investment },
      });
    } catch (error) {
      next(error);
    }
  }

  async topUpInvestment(req, res, next) {
    try {
      const { investmentId, amount, idempotencyKey } = req.body;
      const result = await investmentService.topUpInvestment(
        req.user.id,
        investmentId,
        amount,
        idempotencyKey
      );

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Top-up already processed'
          : 'Investment top-up successful',
        data: { investment: result.investment },
      });
    } catch (error) {
      next(error);
    }
  }

  async getInvestments(req, res, next) {
    try {
      const { page, limit, status } = req.query;
      const result = await investmentService.getInvestments(
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

  async getInvestmentById(req, res, next) {
    try {
      const { id } = req.params;
      const investment = await investmentService.getInvestmentById(id, req.user.id);

      res.status(200).json({
        success: true,
        data: { investment },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const investmentController = new InvestmentController();
