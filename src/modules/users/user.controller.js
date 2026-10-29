import multer from 'multer';
import { UserService } from './user.service.js';

const userService = new UserService();

// Avatar upload — 2MB max, images only, streamed to Cloudinary
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG or WEBP images are allowed'));
  },
}).single('avatar');

export class UserController {
  async getProfile(req, res, next) {
    try {
      const user = await userService.getProfile(req.user.id);

      res.status(200).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const user = await userService.updateProfile(req.user.id, req.body);

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadAvatar(req, res, next) {
    try {
      const user = await userService.updateAvatar(req.user.id, req.file);

      res.status(200).json({
        success: true,
        message: 'Avatar updated',
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }

  async requestWithdrawalPasswordOtp(req, res, next) {
    try {
      await userService.requestWithdrawalPasswordOtp(req.user.id);
      res.status(200).json({ success: true, message: 'OTP sent to your email' });
    } catch (error) {
      next(error);
    }
  }

  async setWithdrawalPassword(req, res, next) {
    try {
      await userService.setWithdrawalPassword(req.user.id, req.body.newPassword, req.body.otp);
      res.status(200).json({ success: true, message: 'Withdrawal password saved' });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
