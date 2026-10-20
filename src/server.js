import app from './app.js';
import { testConnection } from './config/database.js';
import { withdrawalJob } from './jobs/withdrawal.job.js';
import { depositJob } from './jobs/deposit.job.js';
import { rewardJob } from './jobs/reward.job.js';
import { dailyRoiJob } from './jobs/dailyroi.job.js';
import config from './config/env.js';
import logger from './config/logger.js';

const PORT = config.port;

async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Start scheduled jobs (monthly ROI cron disabled — replaced by admin-controlled daily ROI)
    withdrawalJob.start();
    depositJob.start();
    rewardJob.start();
    dailyRoiJob.start();

    // Start server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`API Documentation: http://localhost:${PORT}/api-docs`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
