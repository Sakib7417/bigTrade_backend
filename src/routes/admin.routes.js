import express from 'express';
import { z } from 'zod';
import { adminController } from '../modules/admin/admin.controller.js';
import { depositController } from '../modules/deposits/deposit.controller.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware.js';
import { checkUserExists, checkInvestmentExists, checkWithdrawalExists } from '../middleware/admin.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import {
  updateUserSchema,
  createUserSchema,
  updateUserStatusSchema,
  updateInvestmentStatusSchema,
  walletAdjustmentSchema,
  updateSystemSettingSchema,
} from '../validators/admin.validator.js';
import { approveWithdrawalSchema, rejectWithdrawalSchema, completeWithdrawalSchema } from '../validators/withdrawal.validator.js';
import { setGlobalRoiSchema, setUserRoiSchema, setInvestmentRoiSchema } from '../validators/roi.validator.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate, authorizeAdmin);

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Platform administration (ADMIN role required)
 */

// Users
router.get('/users', adminController.getUsers.bind(adminController));
router.post('/users', validate(createUserSchema), adminController.createUser.bind(adminController));
router.get('/users/:userId', checkUserExists, adminController.getUserById.bind(adminController));
router.patch('/users/:userId', checkUserExists, validate(updateUserSchema), adminController.updateUser.bind(adminController));
router.patch('/users/:userId/status', checkUserExists, validate(updateUserStatusSchema), adminController.updateUserStatus.bind(adminController));
router.get('/users/:userId/referral-tree', checkUserExists, adminController.getUserReferralTree.bind(adminController));

// Investments
router.get('/investments', adminController.getInvestments.bind(adminController));
router.get('/investments/:investmentId', checkInvestmentExists, adminController.getInvestmentById.bind(adminController));
router.patch('/investments/:investmentId/status', checkInvestmentExists, validate(updateInvestmentStatusSchema), adminController.updateInvestmentStatus.bind(adminController));

// Withdrawals
router.get('/withdrawals', adminController.getWithdrawals.bind(adminController));
router.get('/withdrawals/:withdrawalId', checkWithdrawalExists, adminController.getWithdrawalById.bind(adminController));
router.patch('/withdrawals/:withdrawalId/approve', checkWithdrawalExists, validate(approveWithdrawalSchema), adminController.approveWithdrawal.bind(adminController));
router.patch('/withdrawals/:withdrawalId/reject', checkWithdrawalExists, validate(rejectWithdrawalSchema), adminController.rejectWithdrawal.bind(adminController));
router.patch('/withdrawals/:withdrawalId/complete', validate(completeWithdrawalSchema), checkWithdrawalExists, adminController.completeWithdrawal.bind(adminController));

// ROI configuration
router.post('/roi/global', validate(setGlobalRoiSchema), adminController.setGlobalRoi.bind(adminController));
router.get('/roi/global', adminController.getGlobalRoi.bind(adminController));
router.get('/roi/history', adminController.getRoiHistory.bind(adminController));
router.get('/roi/configurations', adminController.getRoiConfigurations.bind(adminController));
router.post('/roi/user/:userId', checkUserExists, validate(setUserRoiSchema), adminController.setUserRoi.bind(adminController));
router.get('/roi/user/:userId', checkUserExists, adminController.getUserRoi.bind(adminController));
router.delete('/roi/user/:userId', checkUserExists, adminController.deleteUserRoi.bind(adminController));
router.post('/roi/investment/:investmentId', checkInvestmentExists, validate(setInvestmentRoiSchema), adminController.setInvestmentRoi.bind(adminController));
router.post('/roi/process', adminController.runRoiJob.bind(adminController));

// Commissions
router.get('/commissions', adminController.getCommissions.bind(adminController));

// Transactions ledger
router.get('/transactions', adminController.getTransactions.bind(adminController));

// Crypto deposits
router.get('/deposits', adminController.getDeposits.bind(adminController));

// Deposit wallet pool (BEP20 + TRC20)
const addWalletSchema = z.object({
  network: z.enum(['BEP20', 'TRC20']),
  address: z.string().min(10),
});
router.get('/deposit-wallets', depositController.listWallets.bind(depositController));
router.post('/deposit-wallets', validate(addWalletSchema), depositController.addWallet.bind(depositController));
router.delete('/deposit-wallets/:id', depositController.removeWallet.bind(depositController));

// Dashboard
router.get('/dashboard', adminController.getDashboardStats.bind(adminController));

// Audit Logs
router.get('/audit-logs', adminController.getAuditLogs.bind(adminController));

// Wallet Adjustments
router.post('/users/:userId/wallet/adjust', checkUserExists, validate(walletAdjustmentSchema), adminController.adjustWalletBalance.bind(adminController));

// System Settings
router.get('/settings', adminController.getSystemSettings.bind(adminController));
router.patch('/settings', validate(updateSystemSettingSchema), adminController.updateSystemSetting.bind(adminController));

export default router;
