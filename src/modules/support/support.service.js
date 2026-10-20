import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../middleware/error.middleware.js';
import logger from '../../config/logger.js';

export class SupportService {
  async createTicket(userId, subject, message) {
    const ticket = await prisma.supportTicket.create({
      data: { userId, subject, message },
    });
    logger.info(`Support ticket created: ${ticket.id} by user ${userId}`);
    return ticket;
  }

  async getMyTickets(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.supportTicket.count({ where: { userId } }),
    ]);
    return { tickets, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAllTickets(page = 1, limit = 20, status = null) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};
    const [tickets, total, openCount] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);
    return { tickets, total, page, limit, totalPages: Math.ceil(total / limit), openCount };
  }

  async replyToTicket(ticketId, adminReply, status, adminId, ipAddress = null) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError('Ticket not found');

    const newStatus = status || 'ANSWERED';
    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        adminReply: adminReply ?? ticket.adminReply,
        status: newStatus,
        repliedBy: adminReply ? adminId : ticket.repliedBy,
        repliedAt: adminReply ? new Date() : ticket.repliedAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'ADMIN_REPLY_TICKET',
        targetType: 'SUPPORT_TICKET',
        targetId: ticketId,
        ipAddress,
        metadata: { status: newStatus },
      },
    });

    logger.info(`Ticket ${ticketId} ${newStatus} by admin ${adminId}`);
    return updated;
  }
}

export const supportService = new SupportService();
