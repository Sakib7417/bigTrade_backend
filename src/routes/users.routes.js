import express from 'express';
import { userController, avatarUpload } from '../modules/users/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { updateProfileSchema, setWithdrawalPasswordSchema } from '../validators/user.validator.js';

const router = express.Router();

/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 */
router.get('/me', authenticate, userController.getProfile.bind(userController));

/**
 * @swagger
 * /api/v1/users/me:
 *   patch:
 *     summary: Update current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               mobile:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.patch('/me', authenticate, validate(updateProfileSchema), userController.updateProfile.bind(userController));

/**
 * @swagger
 * /api/v1/users/me/avatar:
 *   post:
 *     summary: Upload profile photo (multipart, field "avatar")
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post('/me/avatar', authenticate, avatarUpload, userController.uploadAvatar.bind(userController));

/**
 * @swagger
 * /api/v1/users/me/withdrawal-password/request-otp:
 *   post:
 *     summary: Email OTP required to change the withdrawal password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post('/me/withdrawal-password/request-otp', authenticate, userController.requestWithdrawalPasswordOtp.bind(userController));

/**
 * @swagger
 * /api/v1/users/me/withdrawal-password:
 *   post:
 *     summary: Set or change the withdrawal password (OTP required when changing)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post('/me/withdrawal-password', authenticate, validate(setWithdrawalPasswordSchema), userController.setWithdrawalPassword.bind(userController));

export default router;
