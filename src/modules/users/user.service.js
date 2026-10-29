import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/error.middleware.js';
import { uploadImage } from '../../utils/cloudinary.js';
import { authService } from '../auth/auth.service.js';
import logger from '../../config/logger.js';

// How long withdrawals stay locked after the password is set/changed.
// Override per environment: WITHDRAWAL_PASSWORD_LOCK_MINUTES=1440 for 24h.
const WITHDRAWAL_PASSWORD_LOCK_MINUTES = Number(
  process.env.WITHDRAWAL_PASSWORD_LOCK_MINUTES ?? 1440
);

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  role: true,
  referralCode: true,
  status: true,
  avatarUrl: true,
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
      select: { ...SAFE_USER_SELECT, withdrawalPasswordHash: true, withdrawalPasswordSetAt: true },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    user.hasWithdrawalPassword = !!user.withdrawalPasswordHash;
    user.withdrawalPasswordUnlockAt = user.withdrawalPasswordSetAt
      ? new Date(user.withdrawalPasswordSetAt.getTime() + WITHDRAWAL_PASSWORD_LOCK_MINUTES * 60_000)
      : null;
    delete user.withdrawalPasswordHash;
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

  async updateAvatar(userId, file) {
    if (!file) {
      throw new ConflictError('An image file is required');
    }
    const avatarUrl = await uploadImage(file.buffer, 'bigtrade/avatars', `avatar-${userId}`);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: SAFE_USER_SELECT,
    });

    logger.info(`Avatar updated: ${userId}`);
    return user;
  }

  // Email an OTP required to CHANGE an existing withdrawal password.
  async requestWithdrawalPasswordOtp(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) throw new NotFoundError('User not found');
    await authService.sendOtp(user.email, user.name, 'WITHDRAWAL_PASSWORD');
    return { sent: true };
  }

  // First set needs no OTP; changing an existing one requires the emailed code.
  async setWithdrawalPassword(userId, newPassword, otp = null) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, withdrawalPasswordHash: true },
    });
    if (!user) throw new NotFoundError('User not found');

    if (user.withdrawalPasswordHash) {
      if (!otp) {
        throw new ValidationError('Email OTP is required to change the withdrawal password');
      }
      await authService.consumeOtp(user.email, otp, 'WITHDRAWAL_PASSWORD');
    }

    const withdrawalPasswordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { withdrawalPasswordHash, withdrawalPasswordSetAt: new Date() },
    });

    logger.info(`Withdrawal password ${user.withdrawalPasswordHash ? 'changed' : 'set'}: ${userId}`);
    return { ok: true };
  }

  // Gate executed by withdrawal services before a request is created.
  async assertWithdrawalReady(userId, withdrawalPassword) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { withdrawalPasswordHash: true, withdrawalPasswordSetAt: true },
    });

    if (!user?.withdrawalPasswordHash) {
      throw new ConflictError('Please set a withdrawal password in your Profile before withdrawing.');
    }

    const unlockAt = new Date(
      user.withdrawalPasswordSetAt.getTime() + WITHDRAWAL_PASSWORD_LOCK_MINUTES * 60_000
    );
    if (unlockAt > new Date()) {
      const mins = Math.ceil((unlockAt.getTime() - Date.now()) / 60_000);
      const when = mins >= 60 ? `about ${Math.ceil(mins / 60)} hour${mins >= 120 ? 's' : ''}` : `${mins} minute${mins === 1 ? '' : 's'}`;
      throw new ConflictError(
        `For your security, withdrawals unlock in ${when} — you recently set or changed your withdrawal password.`
      );
    }

    if (!withdrawalPassword || !(await bcrypt.compare(withdrawalPassword, user.withdrawalPasswordHash))) {
      throw new ValidationError('Incorrect withdrawal password');
    }
  }
}

export const userService = new UserService();
