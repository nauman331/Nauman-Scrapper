import { connectDatabase, disconnectDatabase } from './persistence/prisma.js';
import { startServer } from './api/server.js';
import { scrapingWorker } from './queue/worker.js';
import { jobService } from './jobs/job.service.js';
import { logger } from './monitoring/logger.js';
import type { FastifyInstance } from 'fastify';

async function bootstrap() {
  logger.info('Initializing Production Web Scraping Platform...');

  // 1. Establish Database Connection
  await connectDatabase();

  // 2. Perform Orphaned Job Recovery (handles previous restarts gracefully)
  await jobService.recoverOrphanedJobs();

  // 3. Start Scraping Worker
  await scrapingWorker.start();

  // 4. Start REST API Server
  const server: FastifyInstance = await startServer();

  // 5. Graceful Shutdown Coordinator
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Received termination signal. Initiating graceful shutdown...');

    try {
      // Step A: Stop accepting new HTTP requests
      await server.close();
      logger.info('HTTP server closed');

      // Step B: Stop queue worker and drain pending jobs
      await scrapingWorker.stop();
      logger.info('Queue worker stopped');

      // Step C: Close database connections
      await disconnectDatabase();
      logger.info('Database connection closed');

      logger.info('Graceful shutdown completed cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ error: err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ error: err }, 'Fatal error during application startup');
  process.exit(1);
});
