import cron from 'node-cron';
import { RoiService } from '../modules/roi/roi.service.js';
import { getCurrentPeriod } from '../utils/roi.js';
import logger from '../config/logger.js';

const roiService = new RoiService();

class RoiJob {
  constructor() {
    this.isRunning = false;
  }

  // Run monthly ROI processing (1st of every month at 00:00)
  startMonthlyJob() {
    // Cron: 0 0 1 * * - At 00:00 on day-of-month 1
    cron.schedule('0 0 1 * *', async () => {
      if (this.isRunning) {
        logger.warn('ROI job is already running, skipping this execution');
        return;
      }

      this.isRunning = true;
      logger.info('Starting monthly ROI job');

      try {
        const period = getCurrentPeriod();

        // Processes ROI + 20-level income atomically per investment.
        // Idempotent: re-running for the same period credits nothing twice
        // (unique investmentId+period constraint on RoiEarning).
        const roiResult = await roiService.processMonthlyRoi(period);

        logger.info(`Monthly ROI job completed: ${JSON.stringify(roiResult)}`);
      } catch (error) {
        logger.error('Monthly ROI job failed:', error);
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('Monthly ROI job scheduled: 1st of every month at 00:00');
  }

  // Manual trigger for a specific period (admin/testing)
  async runManual(period = getCurrentPeriod()) {
    if (this.isRunning) {
      throw new Error('ROI job is already running');
    }

    this.isRunning = true;
    logger.info(`Starting manual ROI job for period: ${period}`);

    try {
      const result = await roiService.processMonthlyRoi(period);
      logger.info(`Manual ROI job completed: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      logger.error('Manual ROI job failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}

export const roiJob = new RoiJob();
