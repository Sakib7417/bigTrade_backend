import { prisma } from '../../config/database.js';
import { ConflictError, NotFoundError } from '../../middleware/error.middleware.js';
import { uploadImage } from '../../utils/cloudinary.js';
import logger from '../../config/logger.js';

const FOLDER = 'bigtrade/kyc';

export class KycService {
  // files = { idFront: [file], idBack?: [file], selfie: [file] } (multer memoryStorage)
  async submit(userId, { documentType, documentNumber }, files) {
    const idFront = files?.idFront?.[0];
    const selfie = files?.selfie?.[0];
    const idBack = files?.idBack?.[0];

    if (!idFront || !selfie) {
      throw new ConflictError('ID front photo and a selfie are required');
    }

    const existing = await prisma.kyc.findUnique({ where: { userId } });
    if (existing?.status === 'APPROVED') {
      throw new ConflictError('KYC is already approved');
    }
    if (existing?.status === 'PENDING') {
      throw new ConflictError('KYC is already under review — wait for admin');
    }

    const [idFrontUrl, selfieUrl, idBackUrl] = await Promise.all([
      uploadImage(idFront.buffer, FOLDER, `id-front-${userId}`),
      uploadImage(selfie.buffer, FOLDER, `selfie-${userId}`),
      idBack
        ? uploadImage(idBack.buffer, FOLDER, `id-back-${userId}`)
        : Promise.resolve(null),
    ]);

    const kyc = await prisma.kyc.upsert({
      where: { userId },
      create: {
        userId,
        documentType,
        documentNumber,
        idFrontUrl,
        idBackUrl,
        selfieUrl,
        status: 'PENDING',
      },
      update: {
        documentType,
        documentNumber,
        idFrontUrl,
        idBackUrl,
        selfieUrl,
        status: 'PENDING',
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
        submittedAt: new Date(),
      },
    });

    logger.info(`KYC submitted: user ${userId}`);
    return kyc;
  }

  async getMine(userId) {
    return prisma.kyc.findUnique({ where: { userId } });
  }

  // Withdrawal gate — throws unless KYC is approved
  async requireApproved(userId) {
    const kyc = await prisma.kyc.findUnique({ where: { userId } });
    if (!kyc) {
      throw new ConflictError('KYC verification is required before withdrawal — submit your documents first');
    }
    if (kyc.status === 'PENDING') {
      throw new ConflictError('Your KYC is under review — withdrawals unlock after admin approval');
    }
    if (kyc.status === 'REJECTED') {
      throw new ConflictError(`Your KYC was rejected${kyc.rejectionReason ? `: ${kyc.rejectionReason}` : ''} — resubmit documents`);
    }
    return kyc;
  }

  async list(status = null, page = 1, limit = 20) {
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.kyc.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              mobile: true,
              referralCode: true,
              status: true,
              createdAt: true,
              wallet: { select: { availableBalance: true } },
              _count: { select: { investments: true } },
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.kyc.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async review(kycId, adminId, approved, reason = null, ipAddress = null) {
    const kyc = await prisma.kyc.findUnique({ where: { id: kycId } });
    if (!kyc) {
      throw new NotFoundError('KYC record not found');
    }
    if (kyc.status !== 'PENDING') {
      throw new ConflictError('KYC already reviewed');
    }
    if (!approved && !reason) {
      throw new ConflictError('Rejection reason is required');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const k = await tx.kyc.update({
        where: { id: kycId },
        data: {
          status: approved ? 'APPROVED' : 'REJECTED',
          rejectionReason: approved ? null : reason,
          reviewedAt: new Date(),
          reviewedBy: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId,
          action: approved ? 'ADMIN_APPROVE_KYC' : 'ADMIN_REJECT_KYC',
          targetType: 'KYC',
          targetId: kycId,
          targetUserId: kyc.userId,
          ipAddress,
          metadata: { documentType: kyc.documentType, reason },
        },
      });
      return k;
    });

    logger.info(`KYC ${approved ? 'approved' : 'rejected'}: ${kycId} by admin ${adminId}`);
    return updated;
  }
}

export const kycService = new KycService();
