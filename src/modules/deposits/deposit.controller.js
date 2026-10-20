import { DepositService } from './deposit.service.js';

const depositService = new DepositService();

export class DepositController {
  async submitDeposit(req, res, next) {
    try {
      const { txHash, network } = req.body;
      const result = await depositService.submitCryptoDeposit(req.user.id, txHash, network);

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        message: result.duplicate
          ? 'Deposit already recorded'
          : result.investment
            ? 'Deposit confirmed and auto-invested'
            : result.deposit.status === 'CREDITED'
              ? 'Deposit confirmed and credited to wallet'
              : 'Deposit recorded, awaiting confirmations',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async recheckDeposit(req, res, next) {
    try {
      const { id } = req.params;
      const deposit = await depositService.getDeposits(req.user.id, 1, 100);
      const found = deposit.deposits.find((d) => d.id === id);
      if (!found) {
        return res.status(404).json({ success: false, message: 'Deposit not found', errorCode: 'NOT_FOUND' });
      }
      const result = await depositService.verifyAndCredit(id);

      res.status(200).json({
        success: true,
        message: result.investment
          ? 'Deposit credited and auto-invested'
          : result.deposit.status === 'CREDITED'
            ? 'Deposit credited'
            : 'Still confirming',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDeposits(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await depositService.getDeposits(
        req.user.id,
        parseInt(page) || 1,
        parseInt(limit) || 10
      );

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getConfig(req, res, next) {
    try {
      res.status(200).json({
        success: true,
        data: await depositService.getDepositConfig(req.query.network),
      });
    } catch (error) {
      next(error);
    }
  }

  // Admin: deposit wallet pool
  async listWallets(req, res, next) {
    try {
      res.status(200).json({ success: true, data: await depositService.listDepositWallets() });
    } catch (error) {
      next(error);
    }
  }

  async addWallet(req, res, next) {
    try {
      const wallet = await depositService.addDepositWallet(
        req.body.network,
        req.body.address,
        req.user.id
      );
      res.status(201).json({ success: true, message: 'Deposit wallet added', data: { wallet } });
    } catch (error) {
      next(error);
    }
  }

  async removeWallet(req, res, next) {
    try {
      await depositService.removeDepositWallet(req.params.id, req.user.id);
      res.status(200).json({ success: true, message: 'Deposit wallet removed' });
    } catch (error) {
      next(error);
    }
  }
}

export const depositController = new DepositController();
