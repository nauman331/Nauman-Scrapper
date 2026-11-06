import { connectDatabase, disconnectDatabase } from './persistence/prisma.js';
import { scrapingWorker } from './queue/worker.js';
import { logger } from './monitoring/logger.js';

async function bootstrapWorker() {
  logger.info('Initializing standalone Scraper Worker process...');

  await connectDatabase();
  await scrapingWorker.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Gracefully shutting down worker process...');
    await scrapingWorker.stop();
    await disconnectDatabase();
    logger.info('Worker shutdown completed. Exiting');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrapWorker().catch((err) => {
  logger.fatal({ error: err }, 'Fatal error during worker bootstrap');
  process.exit(1);
});
