import express from 'express';
import { z } from 'zod';
import { supportController } from '../modules/support/support.controller.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';

const createSchema = z.object({
  subject: z.string().min(3, 'Subject too short').max(200, 'Subject too long'),
  message: z.string().min(5, 'Message too short').max(2000, 'Message too long'),
});

const replySchema = z.object({
  reply: z.string().min(1, 'Reply cannot be empty').max(2000).optional(),
  status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional(),
}).refine((d) => d.reply || d.status, { message: 'Provide a reply or a status' });

// User routes — mounted at /api/v1/support
const router = express.Router();
router.post('/', authenticate, validate(createSchema), supportController.createTicket.bind(supportController));
router.get('/my', authenticate, supportController.getMyTickets.bind(supportController));

// Admin routes — mounted at /api/v1/admin/support
const adminRouter = express.Router();
adminRouter.get('/', authenticate, authorizeAdmin, supportController.getAllTickets.bind(supportController));
adminRouter.patch('/:id', authenticate, authorizeAdmin, validate(replySchema), supportController.replyToTicket.bind(supportController));

export default router;
export { adminRouter as supportAdminRouter };
