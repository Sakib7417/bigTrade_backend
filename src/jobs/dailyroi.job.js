import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { DailyRoiService } from '../modules/dailyroi/dailyroi.service.js';
import { toUtcDate, isPayoutWindowOpen } from '../utils/dailyroi.js';
import logger from '../config/logger.js';

const service = new DailyRoiService();
let isRunning = false;

export const dailyRoiJob = {
  // Sweep every 5 minutes — inside the payout window (6–8 PM) any PUBLISHED
  // rate for today is processed automatically so credits land 6–8 PM.
  start() {
    cron.schedule('*/5 * * * *', async () => {
      if (isRunning || !isPayoutWindowOpen()) return;
      isRunning = true;
      try {
        const today = toUtcDate(new Date());
        // Process today's published rate or any queued requests (any date)
        const pending = await prisma.dailyRoiRate.findMany({
          where: {
            OR: [
              { roiDate: today, status: 'PUBLISHED' },
              { processRequested: true, status: { in: ['PUBLISHED', 'PROCESSED'] } },
            ],
          },
        });
        for (const rate of pending) {
          const result = await service.processDaily(rate.roiDate);
          logger.info(
            `Auto daily ROI processed for ${rate.roiDate.toISOString().slice(0, 10)}: ` +
              `${result.summary.credited} credited, ${result.summary.skipped} skipped`
          );
        }
      } catch (error) {
        logger.error('Daily ROI auto-process job failed:', error);
      } finally {
        isRunning = false;
      }
    });

    logger.info('Daily ROI job scheduled: auto-process inside 6–8 PM window');
  },
};
