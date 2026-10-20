import express from 'express';
import { roiController } from '../modules/roi/roi.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * @swagger
 * /api/v1/roi:
 *   get:
 *     summary: Get current ROI summary (applicable rate, this month's earnings, totals)
 *     tags: [ROI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ROI summary retrieved successfully
 */
router.get('/', authenticate, roiController.getRoiSummary.bind(roiController));

/**
 * @swagger
 * /api/v1/roi/history:
 *   get:
 *     summary: Get user's ROI earning history
 *     tags: [ROI]
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
 *     responses:
 *       200:
 *         description: ROI history retrieved successfully
 */
router.get('/history', authenticate, roiController.getRoiHistory.bind(roiController));

export default router;
