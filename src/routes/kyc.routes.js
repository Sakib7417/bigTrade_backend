import express from 'express';
import { kycController, kycUpload } from '../modules/kyc/kyc.controller.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// User
router.get('/me', authenticate, kycController.getMine.bind(kycController));
router.post('/submit', authenticate, kycUpload, kycController.submit.bind(kycController));

// Admin
router.get('/', authenticate, authorizeAdmin, kycController.list.bind(kycController));
router.patch('/:id/approve', authenticate, authorizeAdmin, kycController.approve.bind(kycController));
router.patch('/:id/reject', authenticate, authorizeAdmin, kycController.reject.bind(kycController));

export default router;
