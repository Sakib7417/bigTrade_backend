import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { DepositService } from '../modules/deposits/deposit.service.js';
import config from '../config/env.js';
import logger from '../config/logger.js';

const depositService = new DepositService();
let isRunning = false;

export const depositJob = {
  // Re-verify pending deposits every minute and credit wallets once the
  // required confirmations are reached — fully idempotent on txHash.
  start() {
    cron.schedule('*/1 * * * *', async () => {
      if (isRunning) {
        return;
      }
      if (!config.blockchain.rpcUrl) {
        return;
      }
      isRunning = true;
      try {
        const pending = await prisma.cryptoDeposit.findMany({
          where: { status: 'PENDING' },
          take: 50,
          orderBy: { createdAt: 'asc' },
        });

        for (const dep of pending) {
          try {
            const result = await depositService.verifyAndCredit(dep.id);
            if (result.deposit?.status === 'CREDITED') {
              logger.info(`Deposit auto-credited: ${dep.txHash} for user ${dep.userId}`);
            }
          } catch (err) {
            logger.warn(`Deposit verification failed for ${dep.txHash}: ${err.message}`);
          }
        }
      } catch (error) {
        logger.error('Deposit confirmation job failed:', error);
      } finally {
        isRunning = false;
      }
    });

    logger.info('Deposit confirmation job scheduled: every minute');
  },
};
