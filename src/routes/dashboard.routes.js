import express from 'express';
import { dashboardController } from '../modules/dashboard/dashboard.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', authenticate, dashboardController.getDashboard.bind(dashboardController));

export default router;
