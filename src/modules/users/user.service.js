import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError } from '../../middleware/error.middleware.js';
import logger from '../../config/logger.js';

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  role: true,
  referralCode: true,
  status: true,
  referredBy: {
    select: { id: true, name: true, email: true, referralCode: true },
  },
  wallet: {
    select: { availableBalance: true, lockedBalance: true },
  },
  createdAt: true,
  updatedAt: true,
};

export class UserService {
  async getProfile(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  async updateProfile(userId, data) {
    const { name, mobile } = data;

    if (mobile) {
      const existing = await prisma.user.findFirst({
        where: { mobile, NOT: { id: userId } },
      });
      if (existing) {
        throw new ConflictError('Mobile number already in use');
      }
    }

    // Role, status, wallet, ROI etc. are intentionally not updatable here
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(mobile && { mobile }),
      },
      select: SAFE_USER_SELECT,
    });

    logger.info(`Profile updated: ${userId}`);
    return user;
  }
}
