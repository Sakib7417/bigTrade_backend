import express from 'express';
import { walletController } from '../modules/wallet/wallet.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * @swagger
 * /api/v1/wallet:
 *   get:
 *     summary: Get user wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet retrieved successfully
 */
router.get('/', authenticate, walletController.getWallet.bind(walletController));

/**
 * @swagger
 * /api/v1/wallet/transactions:
 *   get:
 *     summary: Get wallet transactions
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [DEPOSIT, INVESTMENT, ROI, DIRECT_COMMISSION, LEVEL_COMMISSION, WITHDRAWAL, WITHDRAWAL_FEE, TOP_UP, REFUND, ADMIN_ADJUSTMENT]
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 */
router.get('/transactions', authenticate, walletController.getTransactions.bind(walletController));

export default router;
