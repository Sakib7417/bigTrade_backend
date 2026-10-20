import cron from 'node-cron';
import { rewardService } from '../modules/rewards/reward.service.js';
import logger from '../config/logger.js';

let isRunning = false;

export const rewardJob = {
  // Hourly sweep — catches milestones reached through any path (e.g. direct
  // DB changes or referrals activated after the investment was made).
  start() {
    cron.schedule('7 * * * *', async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        const result = await rewardService.evaluateAll();
        if (result.awarded > 0) {
          logger.info(`Rank reward sweep: ${result.awarded} rewards granted across ${result.evaluated} users`);
        }
      } catch (error) {
        logger.error('Rank reward job failed:', error);
      } finally {
        isRunning = false;
      }
    });

    logger.info('Rank reward job scheduled: hourly');
  },
};
