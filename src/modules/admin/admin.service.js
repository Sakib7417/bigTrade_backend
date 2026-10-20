import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError } from '../../middleware/error.middleware.js';
import { WalletService } from '../wallet/wallet.service.js';
import logger from '../../config/logger.js';

const walletService = new WalletService();

export class AdminService {
  async getUsers(page = 1, limit = 10, search = null, status = null, role = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
      ];
    }
    if (status) {
      where.status = status;
    }
    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          mobile: true,
          role: true,
          referralCode: true,
          status: true,
          referredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        role: true,
        referralCode: true,
        status: true,
        referredBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        wallet: {
          select: {
            id: true,
            availableBalance: true,
            lockedBalance: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  async updateUser(userId, data) {
    const { name, email, mobile, status } = data;

    // Check if email is being changed and if it's already taken
    if (email) {
      const existingEmail = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id: userId },
        },
      });

      if (existingEmail) {
        throw new ConflictError('Email already in use');
      }
    }

    // Check if mobile is being changed and if it's already taken
    if (mobile) {
      const existingMobile = await prisma.user.findFirst({
        where: {
          mobile,
          NOT: { id: userId },
        },
      });

      if (existingMobile) {
        throw new ConflictError('Mobile number already in use');
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(mobile && { mobile }),
        ...(status && { status }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        role: true,
        referralCode: true,
        status: true,
        updatedAt: true,
      },
    });

    logger.info(`User updated: ${userId} by admin`);

    return user;
  }

  async updateUserStatus(userId, status, adminId, ipAddress = null) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id: userId } });
      if (!existing) {
        throw new NotFoundError('User not found');
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: { status },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          adminId,
          action: status === 'SUSPENDED' ? 'ADMIN_SUSPEND_USER' : 'ADMIN_UPDATE_USER_STATUS',
          targetType: 'USER',
          targetId: userId,
          targetUserId: userId,
          ipAddress,
          metadata: { oldStatus: existing.status, newStatus: status },
        },
      });

      logger.info(`User status updated: ${userId} to ${status} by admin ${adminId}`);

      return user;
    });
  }

  async getAllInvestments(page = 1, limit = 10, status = null, userId = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (status) {
      where.status = status;
    }
    if (userId) {
      where.userId = userId;
    }

    const [investments, total] = await Promise.all([
      prisma.investment.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.investment.count({ where }),
    ]);

    return {
      investments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInvestmentById(investmentId) {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            mobile: true,
          },
        },
        roiEarnings: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!investment) {
      throw new NotFoundError('Investment not found');
    }

    return investment;
  }

  async updateInvestmentStatus(investmentId, status, adminId, remarks = null) {
    const investment = await prisma.investment.update({
      where: { id: investmentId },
      data: { status },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'ADMIN_UPDATE_INVESTMENT_STATUS',
        targetType: 'INVESTMENT',
        targetId: investmentId,
        metadata: { status, remarks },
      },
    });

    logger.info(`Investment status updated: ${investmentId} to ${status} by admin ${adminId}`);

    return investment;
  }

  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      totalInvestments,
      activeInvestments,
      totalRoiDistributed,
      totalDirectCommissions,
      totalLevelCommissions,
      pendingWithdrawals,
      completedWithdrawals,
      totalPlatformVolume,
      totalDeposits,
      totalPaidOut,
      totalDailyRoi,
      totalRankRewards,
      pendingDeposits,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.investment.count(),
      prisma.investment.count({ where: { status: 'ACTIVE' } }),
      prisma.roiEarning.aggregate({ _sum: { roiAmount: true } }),
      prisma.commission.aggregate({
        where: { type: 'DIRECT' },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { type: 'LEVEL' },
        _sum: { amount: true },
      }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.withdrawal.count({ where: { status: 'COMPLETED' } }),
      prisma.investment.aggregate({ _sum: { amount: true } }),
      prisma.cryptoDeposit.aggregate({
        where: { status: 'CREDITED' },
        _sum: { amount: true },
      }),
      prisma.withdrawal.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { netAmount: true },
      }),
      prisma.roiPayout.aggregate({
        where: { status: { in: ['CREDITED', 'CAPPED'] } },
        _sum: { creditedAmount: true },
      }),
      prisma.rankReward.aggregate({ _sum: { reward: true }, _count: true }),
      prisma.cryptoDeposit.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      totalInvestments,
      activeInvestments,
      totalRoiDistributed: totalRoiDistributed._sum.roiAmount || 0,
      totalDirectCommissions: totalDirectCommissions._sum.amount || 0,
      totalLevelCommissions: totalLevelCommissions._sum.amount || 0,
      pendingWithdrawals,
      completedWithdrawals,
      totalPlatformVolume: totalPlatformVolume._sum.amount || 0,
      totalDeposits: totalDeposits._sum.amount || 0,
      totalPaidOut: totalPaidOut._sum.netAmount || 0,
      totalDailyRoi: totalDailyRoi._sum.creditedAmount || 0,
      totalRankRewards: totalRankRewards._sum.reward || 0,
      rankRewardsCount: totalRankRewards._count || 0,
      pendingDeposits,
    };
  }

  async getAuditLogs(page = 1, limit = 10, action = null, adminId = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (action) {
      where.action = action;
    }
    if (adminId) {
      where.adminId = adminId;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          targetUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adjustWalletBalance(userId, amount, reason, adminId, idempotencyKey = null) {
    return await walletService.adminAdjustment(userId, amount, reason, adminId, idempotencyKey);
  }

  async getSystemSettings() {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });

    return settings;
  }

  async updateSystemSetting(key, value, adminId) {
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'ADMIN_UPDATE_SYSTEM_SETTING',
        targetType: 'SYSTEM_SETTING',
        targetId: setting.id,
        metadata: { key, value },
      },
    });

    logger.info(`System setting updated: ${key} by admin ${adminId}`);

    return setting;
  }

  async createUser(data, adminId, ipAddress = null) {
    const bcrypt = (await import('bcrypt')).default;
    const { name, email, mobile, password, role = 'USER', referralCode } = data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { mobile }] },
    });
    if (existing) {
      throw new ConflictError('Email or mobile already registered');
    }

    let referredById = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode } });
      if (!referrer) throw new NotFoundError('Invalid referral code');
      referredById = referrer.id;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const code = `U${Math.random().toString(36).slice(2, 9).toUpperCase()}`;

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          mobile,
          passwordHash,
          role,
          referralCode: code,
          referredById,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          email: true,
          mobile: true,
          role: true,
          referralCode: true,
          status: true,
          createdAt: true,
        },
      });

      await tx.wallet.create({
        data: { userId: user.id, availableBalance: 0, lockedBalance: 0 },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'ADMIN_CREATE_USER',
          targetType: 'USER',
          targetId: user.id,
          targetUserId: user.id,
          ipAddress,
          metadata: { email, role },
        },
      });

      logger.info(`User created by admin ${adminId}: ${email}`);
      return user;
    });
  }

  async getTransactions(page = 1, limit = 10, type = null, userId = null) {
    const skip = (page - 1) * limit;

    const where = {};
    if (type) where.type = type;
    if (userId) where.userId = userId;

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    return {
      transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserReferralTree(userId) {
    const { getReferralTree } = await import('../../utils/referral.js');
    const tree = await getReferralTree(userId);
    if (!tree) throw new NotFoundError('User not found');
    return tree;
  }
}
