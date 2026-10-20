import cron from 'node-cron';
import { prisma } from '../config/database.js';
import logger from '../config/logger.js';

// Housekeeping job for withdrawals:
// - Flags stale PENDING withdrawals for admin attention
// - Moves APPROVED withdrawals past a threshold to PROCESSING visibility
// Runs hourly. It never moves money - financial settlement is admin-driven.
class WithdrawalJob {
  constructor() {
    this.isRunning = false;
  }

  start() {
    // Every hour
    cron.schedule('0 * * * *', async () => {
      if (this.isRunning) {
        return;
      }

      this.isRunning = true;

      try {
        const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const stalePending = await prisma.withdrawal.count({
          where: {
            status: 'PENDING',
            createdAt: { lt: staleThreshold },
          },
        });

        if (stalePending > 0) {
          logger.warn(`${stalePending} withdrawal(s) pending for over 24 hours - admin review needed`);
        }
      } catch (error) {
        logger.error('Withdrawal job failed:', error);
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('Withdrawal monitoring job scheduled: hourly');
  }
}

export const withdrawalJob = new WithdrawalJob();
