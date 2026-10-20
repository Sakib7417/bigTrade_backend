import { RoiService } from './roi.service.js';
import logger from '../../config/logger.js';

const roiService = new RoiService();

export class RoiController {
  async getRoiSummary(req, res, next) {
    try {
      const summary = await roiService.getUserRoiSummary(req.user.id);

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }

  async getRoiHistory(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await roiService.getRoiHistory(
        req.user.id,
        parseInt(page) || 1,
        parseInt(limit) || 10
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const roiController = new RoiController();
