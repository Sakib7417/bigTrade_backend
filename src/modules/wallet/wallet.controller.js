import { WalletService } from './wallet.service.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();

export class WalletController {
  async getWallet(req, res, next) {
    try {
      const wallet = await walletService.getWallet(req.user.id);

      res.status(200).json({
        success: true,
        data: { wallet },
      });
    } catch (error) {
      next(error);
    }
  }

  async getTransactions(req, res, next) {
    try {
      const { page, limit, type } = req.query;
      const result = await walletService.getTransactions(
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
}

export const walletController = new WalletController();
