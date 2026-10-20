import express from 'express';
import { authController } from '../modules/auth/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authRateLimit } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { registerSchema, loginSchema, refreshTokenSchema, verifyEmailSchema, resendOtpSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/auth.validator.js';

const router = express.Router();

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - mobile
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               mobile:
 *                 type: string
 *                 example: +1234567890
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePass123
 *               referralCode:
 *                 type: string
 *                 example: ABC12345
 *     responses:
 *       201:
 *         description: User registered successfully
 *       409:
 *         description: Email or mobile already registered
 */
router.post('/register', authRateLimit, validate(registerSchema), authController.register.bind(authController));
router.post('/verify-email', authRateLimit, validate(verifyEmailSchema), authController.verifyEmail.bind(authController));
router.post('/resend-otp', authRateLimit, validate(resendOtpSchema), authController.resendOtp.bind(authController));
router.post('/forgot-password', authRateLimit, validate(forgotPasswordSchema), authController.forgotPassword.bind(authController));
router.post('/reset-password', authRateLimit, validate(resetPasswordSchema), authController.resetPassword.bind(authController));

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or mobile number
 *                 example: john@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePass123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     user:
 *                       type: object
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', authRateLimit, validate(loginSchema), authController.login.bind(authController));

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh', validate(refreshTokenSchema), authController.refresh.bind(authController));

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', authenticate, authController.logout.bind(authController));

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 */
router.get('/me', authenticate, authController.getProfile.bind(authController));

export default router;
