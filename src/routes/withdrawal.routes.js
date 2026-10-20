import express from 'express';
import { withdrawalController } from '../modules/withdrawals/withdrawal.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { withdrawalRateLimit } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { createWithdrawalSchema, createPrincipalWithdrawalSchema } from '../validators/withdrawal.validator.js';

const router = express.Router();

/**
 * @swagger
 * /api/v1/withdrawals:
 *   post:
 *     summary: Create withdrawal request
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - bankDetails
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 10
 *                 example: 100
 *               bankDetails:
 *                 type: object
 *                 required:
 *                   - bankName
 *                   - accountNumber
 *                   - accountName
 *                 properties:
 *                   bankName:
 *                     type: string
 *                   accountNumber:
 *                     type: string
 *                   accountName:
 *                     type: string
 *     responses:
 *       201:
 *         description: Withdrawal request created successfully
 */
router.post('/', authenticate, withdrawalRateLimit, validate(createWithdrawalSchema), withdrawalController.createWithdrawal.bind(withdrawalController));

/**
 * @swagger
 * /api/v1/withdrawals/principal:
 *   post:
 *     summary: Request principal withdrawal (6-month lock, 10% penalty before maturity)
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - investmentId
 *               - bankDetails
 *             properties:
 *               investmentId:
 *                 type: string
 *               bankDetails:
 *                 type: object
 *                 properties:
 *                   bankName:
 *                     type: string
 *                   accountNumber:
 *                     type: string
 *                   accountName:
 *                     type: string
 *     responses:
 *       201:
 *         description: Principal withdrawal request created
 */
router.post('/principal', authenticate, withdrawalRateLimit, validate(createPrincipalWithdrawalSchema), withdrawalController.createPrincipalWithdrawal.bind(withdrawalController));

/**
 * @swagger
 * /api/v1/withdrawals/principal/{investmentId}/eligibility:
 *   get:
 *     summary: Check principal withdrawal eligibility for an investment
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: investmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Eligibility details retrieved
 */
router.get('/principal/:investmentId/eligibility', authenticate, withdrawalController.getPrincipalEligibility.bind(withdrawalController));

/**
 * @swagger
 * /api/v1/withdrawals:
 *   get:
 *     summary: Get user withdrawals
 *     tags: [Withdrawals]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, PROCESSING, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Withdrawals retrieved successfully
 */
router.get('/', authenticate, withdrawalController.getWithdrawals.bind(withdrawalController));

/**
 * @swagger
 * /api/v1/withdrawals/{id}:
 *   get:
 *     summary: Get withdrawal by ID
 *     tags: [Withdrawals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Withdrawal retrieved successfully
 */
router.get('/:id', authenticate, withdrawalController.getWithdrawalById.bind(withdrawalController));

export default router;
