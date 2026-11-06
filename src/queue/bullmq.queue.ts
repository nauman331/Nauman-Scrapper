import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { IJobQueue, QueueJobPayload, QueueMetrics } from './queue.interface.js';
import { ENV } from '../config/env.js';
import { logger } from '../monitoring/logger.js';

export class BullMQQueue implements IJobQueue {
  private queue: Queue;
  private worker: Worker | null = null;
  private redisConnection: Redis;
  private cancelledJobs = new Set<string>();

  constructor() {
    this.redisConnection = new Redis({
      host: ENV.REDIS_HOST,
      port: ENV.REDIS_PORT,
      password: ENV.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.redisConnection.on('error', (err: Error) => {
      logger.error({ error: err.message }, 'Redis connection error');
    });

    this.queue = new Queue('scrape-jobs', {
      connection: this.redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  async addJob(jobId: string, payload: QueueJobPayload, priority = 0): Promise<void> {
    this.cancelledJobs.delete(jobId);

    // BullMQ priority: lower number = higher priority. Map high priority int to BullMQ priority
    const bullPriority = Math.max(1, 100 - priority);

    await this.queue.add('scrape', payload, {
      jobId,
      priority: bullPriority,
      attempts: payload.retryLimit,
    });

    logger.debug({ jobId, priority }, 'Job added to BullMQ queue');
  }

  async cancelJob(jobId: string): Promise<boolean> {
    this.cancelledJobs.add(jobId);

    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
          logger.info({ jobId }, 'Removed waiting BullMQ job');
          return true;
        }
      }
      return true;
    } catch (err) {
      logger.warn({ jobId, error: err }, 'Error removing BullMQ job');
      return false;
    }
  }

  isJobCancelled(jobId: string): boolean {
    return this.cancelledJobs.has(jobId);
  }

  async getQueueMetrics(): Promise<QueueMetrics> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
    };
  }

  async startProcessing(handler: (payload: QueueJobPayload) => Promise<void>): Promise<void> {
    this.worker = new Worker(
      'scrape-jobs',
      async (job: Job<QueueJobPayload>) => {
        if (this.cancelledJobs.has(job.data.jobId)) {
          logger.info({ jobId: job.data.jobId }, 'Discarding cancelled BullMQ job');
          this.cancelledJobs.delete(job.data.jobId);
          return;
        }

        await handler({
          ...job.data,
          attemptNumber: job.attemptsMade + 1,
        });
      },
      {
        connection: this.redisConnection,
        concurrency: ENV.DEFAULT_CONCURRENCY,
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.data.jobId, error: err.message }, 'BullMQ job failed');
    });

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.data.jobId }, 'BullMQ job completed');
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    await this.queue.close();
    await this.redisConnection.quit();
  }
}
