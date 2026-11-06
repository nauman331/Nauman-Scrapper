import type { IJobQueue } from './queue.interface.js';
import { MemoryJobQueue } from './memory.queue.js';
import { BullMQQueue } from './bullmq.queue.js';
import { ENV } from '../config/env.js';
import { logger } from '../monitoring/logger.js';

let queueInstance: IJobQueue | null = null;

export function getJobQueue(): IJobQueue {
  if (queueInstance) {
    return queueInstance;
  }

  if (ENV.QUEUE_ADAPTER === 'redis') {
    try {
      logger.info('Initializing BullMQ queue with Redis adapter');
      queueInstance = new BullMQQueue();
    } catch (err) {
      logger.error(
        { error: err },
        'Failed to initialize BullMQ queue. Falling back to durable in-memory queue'
      );
      queueInstance = new MemoryJobQueue();
    }
  } else {
    logger.info('Initializing durable in-memory queue adapter');
    queueInstance = new MemoryJobQueue();
  }

  return queueInstance;
}
