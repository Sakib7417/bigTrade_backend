import express from 'express';
import authRoutes from './auth.routes.js';
import usersRoutes from './users.routes.js';
import investmentRoutes from './investment.routes.js';
import walletRoutes from './wallet.routes.js';
import withdrawalRoutes from './withdrawal.routes.js';
import depositRoutes from './deposit.routes.js';
import roiRoutes from './roi.routes.js';
import dailyRoiRoutes, { dailyRoiUserRouter } from './dailyroi.routes.js';
import rewardRoutes, { rewardAdminRouter } from './reward.routes.js';
import supportRoutes, { supportAdminRouter } from './support.routes.js';
import referralRoutes from './referral.routes.js';
import adminRoutes from './admin.routes.js';
import dashboardRoutes from './dashboard.routes.js';

const router = express.Router();

// API version prefix
const apiVersion = '/api/v1';

// Mount routes
router.use(`${apiVersion}/auth`, authRoutes);
router.use(`${apiVersion}/users`, usersRoutes);
router.use(`${apiVersion}/investments`, investmentRoutes);
router.use(`${apiVersion}/wallet`, walletRoutes);
router.use(`${apiVersion}/withdrawals`, withdrawalRoutes);
router.use(`${apiVersion}/deposits`, depositRoutes);
router.use(`${apiVersion}/roi`, roiRoutes);
router.use(`${apiVersion}/referrals`, referralRoutes);
router.use(`${apiVersion}/admin`, adminRoutes);
router.use(`${apiVersion}/admin/daily-roi`, dailyRoiRoutes);
router.use(`${apiVersion}/daily-roi`, dailyRoiUserRouter);
router.use(`${apiVersion}/admin/rewards`, rewardAdminRouter);
router.use(`${apiVersion}/rewards`, rewardRoutes);
router.use(`${apiVersion}/support`, supportRoutes);
router.use(`${apiVersion}/admin/support`, supportAdminRouter);
router.use(`${apiVersion}/dashboard`, dashboardRoutes);

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
