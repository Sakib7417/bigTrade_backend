import express from 'express';
import { z } from 'zod';
import { depositController } from '../modules/deposits/deposit.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';

const router = express.Router();

const submitDepositSchema = z.object({
  txHash: z.string().min(10, 'Invalid transaction hash'),
  network: z.enum(['BEP20', 'TRC20']).optional(),
});

/**
 * @swagger
 * /api/v1/deposits/config:
 *   get:
 *     summary: Get crypto deposit configuration (network, contract, platform wallet)
 *     tags: [Deposits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deposit configuration
 */
router.get('/config', authenticate, depositController.getConfig.bind(depositController));

/**
 * @swagger
 * /api/v1/deposits/crypto:
 *   post:
 *     summary: Submit a USDT deposit transaction hash for on-chain verification
 *     tags: [Deposits]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *             properties:
 *               txHash:
 *                 type: string
 *                 example: "0xabc123..."
 *     responses:
 *       201:
 *         description: Deposit recorded
 */
router.post('/crypto', authenticate, validate(submitDepositSchema), depositController.submitDeposit.bind(depositController));

/**
 * @swagger
 * /api/v1/deposits/{id}/recheck:
 *   post:
 *     summary: Re-verify a pending deposit (confirmation check)
 *     tags: [Deposits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deposit status refreshed
 */
router.post('/:id/recheck', authenticate, depositController.recheckDeposit.bind(depositController));

/**
 * @swagger
 * /api/v1/deposits:
 *   get:
 *     summary: List user crypto deposits
 *     tags: [Deposits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deposits retrieved
 */
router.get('/', authenticate, depositController.getDeposits.bind(depositController));

export default router;
