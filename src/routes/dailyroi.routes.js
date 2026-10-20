import express from 'express';
import { z } from 'zod';
import { dailyRoiController } from '../modules/dailyroi/dailyroi.controller.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
 
const router = express.Router();
 
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
 
const saveDraftSchema = z.object({
  roiDate: dateSchema,
  ratePercent: z.number().min(0, 'Rate must be positive').max(100, 'Rate too large'),
  reason: z.string().max(500).optional(),
});
 
const validateSchema = z.object({
  roiDate: dateSchema,
  ratePercent: z.number().min(0).max(100),
});
 
const publishSchema = z.object({
  roiDate: dateSchema,
  ratePercent: z.number().min(0).max(100).optional(),
  reason: z.string().max(500).optional(),
});
 
const processSchema = z.object({
  roiDate: dateSchema,
});

const exclusionSchema = z.object({
  roiDate: dateSchema,
  userId: z.string().min(1, 'userId is required'),
  excluded: z.boolean(),
  reason: z.string().max(500).optional(),
});
 
// User route: own daily ROI history — GET /api/v1/daily-roi/my
const userRouter = express.Router();
userRouter.get('/my', authenticate, dailyRoiController.getMyPayouts.bind(dailyRoiController));
 
// Admin routes mounted under /api/v1/admin/daily-roi
router.get('/cycle', authenticate, authorizeAdmin, dailyRoiController.getCycleOverview.bind(dailyRoiController));
router.get('/history', authenticate, authorizeAdmin, dailyRoiController.getHistory.bind(dailyRoiController));
router.get('/payouts', authenticate, authorizeAdmin, dailyRoiController.getPayouts.bind(dailyRoiController));
router.post('/draft', authenticate, authorizeAdmin, validate(saveDraftSchema), dailyRoiController.saveDraft.bind(dailyRoiController));
router.post('/validate', authenticate, authorizeAdmin, validate(validateSchema), dailyRoiController.validate.bind(dailyRoiController));
router.post('/publish', authenticate, authorizeAdmin, validate(publishSchema), dailyRoiController.publish.bind(dailyRoiController));
router.post('/process', authenticate, authorizeAdmin, validate(processSchema), dailyRoiController.process.bind(dailyRoiController));
router.get('/exclusions', authenticate, authorizeAdmin, dailyRoiController.getExclusions.bind(dailyRoiController));
router.post('/exclusions', authenticate, authorizeAdmin, validate(exclusionSchema), dailyRoiController.setExclusion.bind(dailyRoiController));
 
export default router;
export { userRouter as dailyRoiUserRouter };
 