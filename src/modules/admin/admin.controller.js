import { AdminService } from './admin.service.js';
import { RoiService } from '../roi/roi.service.js';
import { WithdrawalService } from '../withdrawals/withdrawal.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { DepositService } from '../deposits/deposit.service.js';

const adminService = new AdminService();
const roiService = new RoiService();
const withdrawalService = new WithdrawalService();
const commissionService = new CommissionService();
const depositService = new DepositService();

export class AdminController {
  async getUsers(req, res, next) {
    try {
      const { page, limit, search, status, role } = req.query;
      const result = await adminService.getUsers(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        search,
        status,
        role
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserById(req, res, next) {
    try {
      const { userId } = req.params;
      const user = await adminService.getUserById(userId);

      res.status(200).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req, res, next) {
    try {
      const { userId } = req.params;
      const user = await adminService.updateUser(userId, req.body);

      res.status(200).json({
        success: true,
        message: 'User updated successfully',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUserStatus(req, res, next) {
    try {
      const { userId } = req.params;
      const { status } = req.body;
      const user = await adminService.updateUserStatus(userId, status, req.user.id, req.ip);

      res.status(200).json({
        success: true,
        message: 'User status updated successfully',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async getInvestments(req, res, next) {
    try {
      const { page, limit, status, userId } = req.query;
      const result = await adminService.getAllInvestments(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        status,
        userId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getInvestmentById(req, res, next) {
    try {
      const { investmentId } = req.params;
      const investment = await adminService.getInvestmentById(investmentId);

      res.status(200).json({
        success: true,
        data: { investment },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateInvestmentStatus(req, res, next) {
    try {
      const { investmentId } = req.params;
      const { status, remarks } = req.body;
      const investment = await adminService.updateInvestmentStatus(
        investmentId,
        status,
        req.user.id,
        remarks
      );

      res.status(200).json({
        success: true,
        message: 'Investment status updated successfully',
        data: { investment },
      });
    } catch (error) {
      next(error);
    }
  }

  async getWithdrawals(req, res, next) {
    try {
      const { page, limit, status } = req.query;
      const result = await withdrawalService.getAllWithdrawals(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        status
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getWithdrawalById(req, res, next) {
    try {
      const { withdrawalId } = req.params;
      const withdrawal = await withdrawalService.getWithdrawalByIdAdmin(withdrawalId);

      res.status(200).json({
        success: true,
        data: { withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  async approveWithdrawal(req, res, next) {
    try {
      const { withdrawalId } = req.params;
      const { remarks } = req.body;
      const withdrawal = await withdrawalService.approveWithdrawal(
        withdrawalId,
        req.user.id,
        remarks,
        req.ip
      );

      res.status(200).json({
        success: true,
        message: 'Withdrawal approved successfully',
        data: { withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  async rejectWithdrawal(req, res, next) {
    try {
      const { withdrawalId } = req.params;
      const { reason } = req.body;
      const withdrawal = await withdrawalService.rejectWithdrawal(
        withdrawalId,
        req.user.id,
        reason,
        req.ip
      );

      res.status(200).json({
        success: true,
        message: 'Withdrawal rejected successfully',
        data: { withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  async completeWithdrawal(req, res, next) {
    try {
      const { withdrawalId } = req.params;
      const withdrawal = await withdrawalService.completeWithdrawal(
        withdrawalId,
        req.user.id,
        req.ip,
        req.body?.txHash
      );

      res.status(200).json({
        success: true,
        message: 'Withdrawal completed successfully',
        data: { withdrawal },
      });
    } catch (error) {
      next(error);
    }
  }

  async setGlobalRoi(req, res, next) {
    try {
      const { roiPercent, period } = req.body;
      const config = await roiService.setGlobalRoi(roiPercent, period, req.user.id, req.ip);

      res.status(201).json({
        success: true,
        message: 'Global ROI set successfully',
        data: { config },
      });
    } catch (error) {
      next(error);
    }
  }

  async setUserRoi(req, res, next) {
    try {
      const { userId } = req.params;
      const { roiPercent, period } = req.body;
      const config = await roiService.setUserRoi(userId, roiPercent, period, req.user.id, req.ip);

      res.status(201).json({
        success: true,
        message: 'User ROI set successfully',
        data: { config },
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteUserRoi(req, res, next) {
    try {
      const { userId } = req.params;
      const { period } = req.query;
      const result = await roiService.deleteUserRoi(userId, period, req.user.id, req.ip);

      res.status(200).json({
        success: true,
        message: 'User ROI deleted successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getGlobalRoi(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await roiService.getGlobalRoiHistory(
        parseInt(page) || 1,
        parseInt(limit) || 20
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserRoi(req, res, next) {
    try {
      const { userId } = req.params;
      const { page, limit } = req.query;
      const result = await roiService.getUserRoiConfigs(
        userId,
        parseInt(page) || 1,
        parseInt(limit) || 20
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async setInvestmentRoi(req, res, next) {
    try {
      const { investmentId } = req.params;
      const { roiPercent, period } = req.body;
      const config = await roiService.setInvestmentRoi(
        investmentId,
        roiPercent,
        period,
        req.user.id,
        req.ip
      );

      res.status(201).json({
        success: true,
        message: 'Investment ROI set successfully',
        data: { config },
      });
    } catch (error) {
      next(error);
    }
  }

  async getRoiHistory(req, res, next) {
    try {
      const { page, limit, period, userId } = req.query;
      const result = await roiService.getAllRoiEarnings(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        period,
        userId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async runRoiJob(req, res, next) {
    try {
      const { period } = req.body;
      const { roiJob } = await import('../../jobs/roi.job.js');
      const result = await roiJob.runManual(period);

      res.status(200).json({
        success: true,
        message: 'ROI job executed',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getRoiConfigurations(req, res, next) {
    try {
      const { page, limit, type } = req.query;
      const result = await roiService.getRoiConfigurations(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        type
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDashboardStats(req, res, next) {
    try {
      const stats = await adminService.getDashboardStats();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAuditLogs(req, res, next) {
    try {
      const { page, limit, action, adminId } = req.query;
      const result = await adminService.getAuditLogs(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        action,
        adminId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async adjustWalletBalance(req, res, next) {
    try {
      const { userId } = req.params;
      const { amount, reason, idempotencyKey } = req.body;
      const result = await adminService.adjustWalletBalance(userId, amount, reason, req.user.id, idempotencyKey);

      res.status(200).json({
        success: true,
        message: 'Wallet balance adjusted successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getSystemSettings(req, res, next) {
    try {
      const settings = await adminService.getSystemSettings();

      res.status(200).json({
        success: true,
        data: { settings },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSystemSetting(req, res, next) {
    try {
      const { key, value } = req.body;
      const setting = await adminService.updateSystemSetting(key, value, req.user.id);

      res.status(200).json({
        success: true,
        message: 'System setting updated successfully',
        data: { setting },
      });
    } catch (error) {
      next(error);
    }
  }

  async createUser(req, res, next) {
    try {
      const user = await adminService.createUser(req.body, req.user.id, req.ip);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async getTransactions(req, res, next) {
    try {
      const { page, limit, type, userId } = req.query;
      const result = await adminService.getTransactions(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        type,
        userId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getCommissions(req, res, next) {
    try {
      const { page, limit, type, userId } = req.query;
      const result = await commissionService.getAllCommissions(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        type,
        userId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDeposits(req, res, next) {
    try {
      const { page, limit, status } = req.query;
      const result = await depositService.getAllDeposits(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        status
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserReferralTree(req, res, next) {
    try {
      const { userId } = req.params;
      const tree = await adminService.getUserReferralTree(userId);

      res.status(200).json({
        success: true,
        data: { tree },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
