import { rewardService } from './reward.service.js';
import { prisma } from '../../config/database.js';

export class RewardController {
  // User: claimed rank rewards + live progress
  async getMyRewards(req, res, next) {
    try {
      const data = await rewardService.getMyRewards(req.user.id);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // Admin: full reward history
  async getAllRewards(req, res, next) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const [rewards, total] = await Promise.all([
        prisma.rankReward.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.rankReward.count(),
      ]);

      res.status(200).json({
        success: true,
        data: { rewards, total, page, limit, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      next(error);
    }
  }

  // Admin: force a full re-evaluation (idempotent — already-claimed ranks are skipped)
  async evaluateAll(req, res, next) {
    try {
      const result = await rewardService.evaluateAll();
      res.status(200).json({
        success: true,
        message: `Evaluated ${result.evaluated} users — ${result.awarded} rewards granted`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const rewardController = new RewardController();
