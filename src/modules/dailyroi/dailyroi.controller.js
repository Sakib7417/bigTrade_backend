import { DailyRoiService } from './dailyroi.service.js';
 
const dailyRoiService = new DailyRoiService();
 
export class DailyRoiController {
  async getCycleOverview(req, res, next) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const data = await dailyRoiService.getCycleOverview(date);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
 
  async saveDraft(req, res, next) {
    try {
      const { roiDate, ratePercent, reason } = req.body;
      const result = await dailyRoiService.saveDraft(
        { roiDate, ratePercent, reason },
        req.user.id
      );
      res.status(200).json({
        success: true,
        message: 'Daily ROI draft saved',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
 
  async validate(req, res, next) {
    try {
      const { roiDate, ratePercent } = req.body;
      const result = await dailyRoiService.validateRate(roiDate, ratePercent);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
 
  async publish(req, res, next) {
    try {
      const { roiDate, ratePercent, reason } = req.body;
      const result = await dailyRoiService.publish(
        { roiDate, ratePercent, reason },
        req.user.id,
        req.ip
      );
      res.status(200).json({
        success: true,
        message: `Daily ROI of ${result.rate.ratePercent}% published for ${result.rate.roiDate.toISOString().slice(0, 10)}`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
 
  async process(req, res, next) {
    try {
      const { roiDate } = req.body;
      const result = await dailyRoiService.processDaily(roiDate, req.user.id, req.ip);
      res.status(200).json({
        success: true,
        message: result.queued
          ? result.message
          : `Payouts processed: ${result.summary.credited} credited, ${result.summary.capped} capped, ${result.summary.skipped} skipped, ${result.summary.failed} failed`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
 
  async getHistory(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await dailyRoiService.getHistory(parseInt(page) || 1, parseInt(limit) || 20);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
 
  async getPayouts(req, res, next) {
    try {
      const { date, page, limit, status } = req.query;
      const result = await dailyRoiService.getPayouts(
        date || null,
        parseInt(page) || 1,
        parseInt(limit) || 20,
        status || null
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
 
  async getExclusions(req, res, next) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const rows = await dailyRoiService.getExclusions(date);
      res.status(200).json({ success: true, data: { roiDate: date, exclusions: rows } });
    } catch (error) {
      next(error);
    }
  }

  async setExclusion(req, res, next) {
    try {
      const { roiDate, userId, excluded, reason } = req.body;
      const result = await dailyRoiService.setExclusion(
        { roiDate, userId, excluded, reason },
        req.user.id,
        req.ip
      );
      res.status(200).json({
        success: true,
        message: result.excluded ? 'User excluded from this date' : 'Exclusion removed',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // User-facing: own daily ROI history
  async getMyPayouts(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await dailyRoiService.getPayouts(
        null,
        parseInt(page) || 1,
        parseInt(limit) || 20,
        null,
        req.user.id
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}
 
export const dailyRoiController = new DailyRoiController();
 