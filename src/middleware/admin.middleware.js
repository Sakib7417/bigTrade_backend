import { prisma } from '../config/database.js';
import { NotFoundError } from './error.middleware.js';

export const checkUserExists = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        role: true,
        status: true,
        referralCode: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    req.targetUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const checkInvestmentExists = async (req, res, next) => {
  try {
    const { investmentId } = req.params;

    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!investment) {
      throw new NotFoundError('Investment not found');
    }

    req.targetInvestment = investment;
    next();
  } catch (error) {
    next(error);
  }
};

export const checkWithdrawalExists = async (req, res, next) => {
  try {
    const { withdrawalId } = req.params;

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundError('Withdrawal not found');
    }

    req.targetWithdrawal = withdrawal;
    next();
  } catch (error) {
    next(error);
  }
};
