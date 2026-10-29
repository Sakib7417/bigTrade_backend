import { prisma } from '../../config/database.js';
import logger from '../../config/logger.js';

export class DashboardController {
  async getDashboard(req, res, next) {
    try {
      const userId = req.user.id;

      const [
        wallet,
        totalInvestment,
        totalRoi,
        totalDirectIncome,
        totalLevelIncome,
        totalWithdrawal,
        activeInvestments,
        teamSize,
      ] = await Promise.all([
        prisma.wallet.findUnique({
          where: { userId },
          select: { availableBalance: true },
        }),
        prisma.investment.aggregate({
          // Only live investments count — principal already withdrawn is COMPLETED,
          // cancelled ones never reached the user's money either.
          where: { userId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          _sum: { amount: true },
        }),
        prisma.roiEarning.aggregate({
          where: { userId },
          _sum: { roiAmount: true },
        }).then(async (legacy) => {
          // New daily-ROI engine writes to RoiPayout — include both
          const daily = await prisma.roiPayout.aggregate({
            where: { userId, status: 'CREDITED' },
            _sum: { creditedAmount: true },
          });
          return {
            _sum: {
              roiAmount:
                Number(legacy._sum.roiAmount || 0) + Number(daily._sum.creditedAmount || 0),
            },
          };
        }),
        prisma.commission.aggregate({
          where: { userId, type: 'DIRECT' },
          _sum: { amount: true },
        }),
        prisma.commission.aggregate({
          where: { userId, type: 'LEVEL' },
          _sum: { amount: true },
        }),
        prisma.withdrawal.aggregate({
          where: { userId, status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        prisma.investment.count({
          where: { userId, status: 'ACTIVE' },
        }),
        prisma.user.count({
          where: { referredById: userId },
        }),
      ]);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });

      res.status(200).json({
        success: true,
        data: {
          walletBalance: wallet?.availableBalance || 0,
          totalInvestment: totalInvestment._sum.amount || 0,
          totalRoi: totalRoi._sum.roiAmount || 0,
          totalDirectIncome: totalDirectIncome._sum.amount || 0,
          totalLevelIncome: totalLevelIncome._sum.amount || 0,
          totalWithdrawal: totalWithdrawal._sum.amount || 0,
          activeInvestments,
          teamSize,
          referralCode: user?.referralCode || '',
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const dashboardController = new DashboardController();
