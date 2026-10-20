import { supportService } from './support.service.js';

export class SupportController {
  async createTicket(req, res, next) {
    try {
      const { subject, message } = req.body;
      const ticket = await supportService.createTicket(req.user.id, subject, message);
      res.status(201).json({ success: true, message: 'Ticket submitted — admin will respond soon', data: ticket });
    } catch (error) {
      next(error);
    }
  }

  async getMyTickets(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await supportService.getMyTickets(req.user.id, parseInt(page) || 1, parseInt(limit) || 10);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getAllTickets(req, res, next) {
    try {
      const { page, limit, status } = req.query;
      const result = await supportService.getAllTickets(parseInt(page) || 1, parseInt(limit) || 20, status || null);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async replyToTicket(req, res, next) {
    try {
      const { id } = req.params;
      const { reply, status } = req.body;
      const ticket = await supportService.replyToTicket(id, reply, status, req.user.id, req.ip);
      res.status(200).json({ success: true, message: 'Ticket updated', data: ticket });
    } catch (error) {
      next(error);
    }
  }
}

export const supportController = new SupportController();
