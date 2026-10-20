import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { generateReferralCode } from '../../utils/referral.js';
import { generateOtp, hashOtp, sendOtpEmail } from '../../utils/email.js';
import { ConflictError, AuthenticationError, NotFoundError, ValidationError } from '../../middleware/error.middleware.js';
import config from '../../config/env.js';
import logger from '../../config/logger.js';

const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;

export class AuthService {
  async issueTokens(userId) {
    const accessToken = generateAccessToken({ userId });
    const refreshToken = generateRefreshToken({ userId });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  // Create + email a fresh OTP (REGISTER or RESET purpose)
  async sendOtp(email, name = '', purpose = 'REGISTER') {
    const code = generateOtp();
    await prisma.emailOtp.create({
      data: {
        email,
        codeHash: hashOtp(code),
        purpose,
        expiresAt: new Date(Date.now() + config.brevo.otpMinutes * 60_000),
      },
    });
    const sent = await sendOtpEmail(email, code, name, purpose);
    if (!sent) logger.warn(`OTP email could not be sent to ${email}`);
    return sent;
  }

  async consumeOtp(email, code, purpose) {
    const otp = await prisma.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date()) {
      throw new ValidationError('Code expired — request a new one');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new ValidationError('Too many wrong attempts — request a new code');
    }

    if (otp.codeHash !== hashOtp(code)) {
      await prisma.emailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new ValidationError('Incorrect verification code');
    }

    await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }

  async forgotPassword(email) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Don't reveal whether the account exists — but only send when it does
    if (user) {
      const last = await prisma.emailOtp.findFirst({
        where: { email, purpose: 'RESET' },
        orderBy: { createdAt: 'desc' },
      });
      if (!last || Date.now() - last.createdAt.getTime() >= OTP_RESEND_SECONDS * 1000) {
        await this.sendOtp(email, user.name, 'RESET');
      }
    }
    return { sent: true };
  }

  async resetPassword(email, code, newPassword) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundError('Account not found');

    await this.consumeOtp(email, code, 'RESET');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Force re-login everywhere after a password change
      prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } }),
    ]);

    logger.info(`Password reset: ${email}`);
    return { reset: true };
  }

  async register(data) {
    const { name, email, mobile, password, referralCode } = data;

    // Check if email exists
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail?.emailVerifiedAt) {
      throw new ConflictError('Email already registered');
    }

    // Check if mobile exists
    const existingMobile = await prisma.user.findUnique({ where: { mobile } });
    if (existingMobile && existingMobile.id !== existingEmail?.id) {
      throw new ConflictError('Mobile number already registered');
    }

    // Validate referral code if provided
    let referredBy = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode },
      });

      if (!referrer) {
        throw new NotFoundError('Invalid referral code');
      }

      if (referrer.email === email || referrer.mobile === mobile) {
        throw new ConflictError('Cannot refer yourself');
      }

      referredBy = referrer;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Unverified account re-registering → update details and resend the OTP
    // instead of blocking with "email already exists"
    if (existingEmail && !existingEmail.emailVerifiedAt) {
      const user = await prisma.user.update({
        where: { id: existingEmail.id },
        data: {
          name,
          mobile,
          passwordHash,
          ...(referredBy ? { referredById: referredBy.id } : {}),
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

      await this.sendOtp(user.email, user.name);
      logger.info(`Unverified user re-registered, OTP resent: ${user.email}`);

      return {
        requiresVerification: true,
        email: user.email,
        user,
      };
    }

    // Generate unique referral code
    const userReferralCode = await this.generateUniqueReferralCode(name);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        mobile,
        passwordHash,
        referralCode: userReferralCode,
        referredById: referredBy?.id,
        role: 'USER',
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

    // Create wallet
    await prisma.wallet.create({
      data: {
        userId: user.id,
        availableBalance: 0,
        lockedBalance: 0,
      },
    });

    // Email OTP verification — tokens are issued only after verify-email
    await this.sendOtp(user.email, user.name);

    logger.info(`User registered (unverified): ${user.email}`);

    return {
      requiresVerification: true,
      email: user.email,
      user,
    };
  }

  async verifyEmail(email, code) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundError('Account not found');
    if (user.emailVerifiedAt) {
      const tokens = await this.issueTokens(user.id);
      return { ...tokens, user };
    }

    await this.consumeOtp(email, code, 'REGISTER');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });

    const tokens = await this.issueTokens(user.id);
    logger.info(`Email verified: ${email}`);
    return { ...tokens, user };
  }

  async resendOtp(email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundError('Account not found');
    if (user.emailVerifiedAt) throw new ConflictError('Email is already verified');

    const last = await prisma.emailOtp.findFirst({
      where: { email, purpose: 'REGISTER' },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
      throw new ConflictError(`Please wait ${OTP_RESEND_SECONDS}s before requesting a new code`);
    }

    await this.sendOtp(email, user.name);
    return { sent: true };
  }

  async login(identifier, password) {
    // Find user by email or mobile
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { mobile: identifier }],
      },
    });

    if (!user) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Check user status
    if (user.status !== 'ACTIVE') {
      throw new AuthenticationError('Account is not active');
    }

    if (!user.emailVerifiedAt) {
      throw new AuthenticationError(
        'Please verify your email — check your inbox for the code',
        'EMAIL_NOT_VERIFIED'
      );
    }

    const userData = {
      userId: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      referralCode: user.referralCode,
      status: user.status,
    };

    // Generate tokens
    const { accessToken, refreshToken } = await this.issueTokens(user.id);

    logger.info(`User logged in: ${user.email}`);

    return {
      accessToken,
      refreshToken,
      user: userData,
    };
  }

  async refresh(refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);

      // Check if refresh token exists and is not revoked
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });

      if (!storedToken || storedToken.revokedAt) {
        throw new AuthenticationError('Invalid refresh token');
      }

      if (storedToken.expiresAt < new Date()) {
        throw new AuthenticationError('Refresh token expired');
      }

      if (storedToken.user.status !== 'ACTIVE') {
        throw new AuthenticationError('Account is not active');
      }

      // Generate new tokens
      const accessToken = generateAccessToken({ userId: decoded.userId });
      const newRefreshToken = generateRefreshToken({ userId: decoded.userId });

      // Revoke old token and create new one
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: decoded.userId,
          expiresAt,
        },
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new AuthenticationError('Invalid refresh token');
    }
  }

  async logout(refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });

    logger.info('User logged out');
  }

  async generateUniqueReferralCode(name) {
    const prefix = name.substring(0, 3).toUpperCase();
    let code = generateReferralCode(prefix);
    let attempts = 0;

    while (attempts < 10) {
      const existing = await prisma.user.findUnique({
        where: { referralCode: code },
      });

      if (!existing) {
        return code;
      }

      code = generateReferralCode(prefix);
      attempts++;
    }

    // Fallback to random
    return generateReferralCode();
  }
}
