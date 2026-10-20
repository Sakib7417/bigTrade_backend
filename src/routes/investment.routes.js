import express from 'express';
import { investmentController } from '../modules/investments/investment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { investmentRateLimit } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { createInvestmentSchema, topUpInvestmentSchema } from '../validators/investment.validator.js';

const router = express.Router();

/**
 * @swagger
 * /api/v1/investments:
 *   post:
 *     summary: Create a new investment
 *     tags: [Investments]
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
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 100
 *                 example: 1000
 *     responses:
 *       201:
 *         description: Investment created successfully
 *       400:
 *         description: Invalid amount or insufficient balance
 */
router.post('/', authenticate, investmentRateLimit, validate(createInvestmentSchema), investmentController.createInvestment.bind(investmentController));

/**
 * @swagger
 * /api/v1/investments/top-up:
 *   post:
 *     summary: Top-up existing investment
 *     tags: [Investments]
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
 *               - amount
 *             properties:
 *               investmentId:
 *                 type: string
 *               amount:
 *                 type: number
 *                 minimum: 100
 *                 example: 500
 *     responses:
 *       201:
 *         description: Investment top-up successful
 */
router.post('/top-up', authenticate, investmentRateLimit, validate(topUpInvestmentSchema), investmentController.topUpInvestment.bind(investmentController));

/**
 * @swagger
 * /api/v1/investments:
 *   get:
 *     summary: Get user investments
 *     tags: [Investments]
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
 *           enum: [ACTIVE, CAPPED, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Investments retrieved successfully
 */
router.get('/', authenticate, investmentController.getInvestments.bind(investmentController));

/**
 * @swagger
 * /api/v1/investments/{id}:
 *   get:
 *     summary: Get investment by ID
 *     tags: [Investments]
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
 *         description: Investment retrieved successfully
 */
router.get('/:id', authenticate, investmentController.getInvestmentById.bind(investmentController));

export default router;
