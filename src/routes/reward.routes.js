import express from 'express';
import { rewardController } from '../modules/rewards/reward.controller.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// User: my rank rewards + progress
router.get('/my', authenticate, rewardController.getMyRewards.bind(rewardController));

// Admin: history + manual re-evaluation
const adminRouter = express.Router();
adminRouter.get('/', authenticate, authorizeAdmin, rewardController.getAllRewards.bind(rewardController));
adminRouter.post('/evaluate', authenticate, authorizeAdmin, rewardController.evaluateAll.bind(rewardController));

export default router;
export { adminRouter as rewardAdminRouter };
