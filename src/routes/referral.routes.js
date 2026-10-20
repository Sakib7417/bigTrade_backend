import express from 'express';
import { referralController } from '../modules/referrals/referral.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', authenticate, referralController.getDirectReferrals.bind(referralController));
router.get('/tree', authenticate, referralController.getReferralTree.bind(referralController));
router.get('/direct', authenticate, referralController.getDirectReferrals.bind(referralController));
router.get('/level/:level', authenticate, referralController.getReferralsByLevel.bind(referralController));
router.get('/commissions', authenticate, referralController.getCommissions.bind(referralController));
router.get('/commissions/stats', authenticate, referralController.getCommissionStats.bind(referralController));
router.get('/stats', authenticate, referralController.getReferralStats.bind(referralController));

export default router;
