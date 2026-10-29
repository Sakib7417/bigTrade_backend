import multer from 'multer';
import { z } from 'zod';
import { kycService } from './kyc.service.js';

const submitSchema = z.object({
  documentType: z.enum(['PASSPORT', 'DRIVING_LICENSE', 'NATIONAL_ID']),
  documentNumber: z.string().min(4, 'Document number is required').max(50),
});

// In-memory uploads → streamed to Cloudinary (5MB per image, images only)
export const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG or WEBP images are allowed'));
  },
}).fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
]);

export class KycController {
  async submit(req, res, next) {
    try {
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
      }
      const kyc = await kycService.submit(req.user.id, parsed.data, req.files);
      res.status(201).json({
        success: true,
        message: 'KYC submitted — under review',
        data: { kyc },
      });
    } catch (error) {
      next(error);
    }
  }

  async getMine(req, res, next) {
    try {
      const kyc = await kycService.getMine(req.user.id);
      res.status(200).json({ success: true, data: { kyc } });
    } catch (error) {
      next(error);
    }
  }

  // ---- admin ----

  async list(req, res, next) {
    try {
      const { page, limit, status } = req.query;
      const result = await kycService.list(status || null, parseInt(page) || 1, parseInt(limit) || 20);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async approve(req, res, next) {
    try {
      const kyc = await kycService.review(req.params.id, req.user.id, true, null, req.ip);
      res.status(200).json({ success: true, message: 'KYC approved', data: { kyc } });
    } catch (error) {
      next(error);
    }
  }

  async reject(req, res, next) {
    try {
      const kyc = await kycService.review(req.params.id, req.user.id, false, req.body.reason, req.ip);
      res.status(200).json({ success: true, message: 'KYC rejected', data: { kyc } });
    } catch (error) {
      next(error);
    }
  }
}

export const kycController = new KycController();
