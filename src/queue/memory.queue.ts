import type { IJobQueue, QueueJobPayload, QueueMetrics } from './queue.interface.js';
import { logger } from '../monitoring/logger.js';
import { ENV } from '../config/env.js';

interface QueuedItem {
  id: string;
  payload: QueueJobPayload;
  priority: number;
  addedAt: number;
  attempts: number;
}

export class MemoryJobQueue implements IJobQueue {
  private queue: QueuedItem[] = [];
  private activeJobs = new Map<string, QueuedItem>();
  private cancelledJobIds = new Set<string>();
  private completedCount = 0;
  private failedCount = 0;
  private concurrency: number;
  private isRunning = false;
  private isClosing = false;
  private handler: ((payload: QueueJobPayload) => Promise<void>) | null = null;
  private processInterval: NodeJS.Timeout | null = null;

  constructor(concurrency = ENV.LOCAL_WORKER_PROCESSES) {
    this.concurrency = concurrency;
  }

  async addJob(jobId: string, payload: QueueJobPayload, priority = 0): Promise<void> {
    // If job was previously marked cancelled, reset cancellation for new submission
    this.cancelledJobIds.delete(jobId);

    const item: QueuedItem = {
      id: jobId,
      payload,
      priority,
      addedAt: Date.now(),
      attempts: 0,
    };

    // Insert item maintaining priority order (higher priority first; then oldest first)
    const insertIdx = this.queue.findIndex(
      (q) => q.priority < item.priority || (q.priority === item.priority && q.addedAt > item.addedAt)
    );

    if (insertIdx === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIdx, 0, item);
    }

    logger.debug({ jobId, priority, queueLength: this.queue.length }, 'Job added to in-memory queue');
    this.triggerProcessing();
  }

  async cancelJob(jobId: string): Promise<boolean> {
    this.cancelledJobIds.add(jobId);

    // Remove from waiting queue if not yet active
    const idx = this.queue.findIndex((q) => q.id === jobId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this.completedCount++;
      logger.info({ jobId }, 'Job cancelled before worker picked it up');
      return true;
    }

    // If currently active, worker is signalled via isJobCancelled(jobId)
    if (this.activeJobs.has(jobId)) {
      logger.info({ jobId }, 'Active running job flagged for cancellation');
      return true;
    }

    return false;
  }

  isJobCancelled(jobId: string): boolean {
    return this.cancelledJobIds.has(jobId);
  }

  async getQueueMetrics(): Promise<QueueMetrics> {
    return {
      waiting: this.queue.length,
      active: this.activeJobs.size,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  async startProcessing(handler: (payload: QueueJobPayload) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.isRunning = true;
    this.triggerProcessing();

    // Periodic safety check for pending jobs
    this.processInterval = setInterval(() => {
      this.triggerProcessing();
    }, 1000);
  }

  private triggerProcessing(): void {
    if (!this.isRunning || this.isClosing || !this.handler) return;

    while (this.activeJobs.size < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      if (this.cancelledJobIds.has(item.id)) {
        logger.info({ jobId: item.id }, 'Discarding cancelled job from memory queue');
        this.cancelledJobIds.delete(item.id);
        continue;
      }

      this.executeJob(item);
    }
  }

  private async executeJob(item: QueuedItem): Promise<void> {
    if (!this.handler) return;

    this.activeJobs.set(item.id, item);
    item.attempts++;

    try {
      logger.info({ jobId: item.id, attempt: item.attempts }, 'Worker executing job from memory queue');
      await this.handler({
        ...item.payload,
        attemptNumber: item.attempts,
      });

      this.completedCount++;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: item.id, attempt: item.attempts, error: errorMsg }, 'Job execution failed in queue');

      // Retry with bounded exponential backoff and jitter if under retry limit
      if (item.attempts < item.payload.retryLimit && !this.cancelledJobIds.has(item.id)) {
        // Bounded exponential backoff: min(2^(attempt - 1) * 1000, 30000) + random jitter (0-500ms)
        const baseDelay = Math.min(Math.pow(2, item.attempts - 1) * 1000, 30000);
        const jitter = Math.floor(Math.random() * 500);
        const retryDelay = baseDelay + jitter;

        logger.info(
          { jobId: item.id, attempt: item.attempts, retryDelayMs: retryDelay },
          'Scheduling job retry with exponential backoff'
        );

        setTimeout(() => {
          if (!this.cancelledJobIds.has(item.id) && !this.isClosing) {
            // Preserve the attempt counter; addJob would reset it and retry forever.
            const index = this.queue.findIndex(queued => queued.priority < item.priority);
            if (index === -1) this.queue.push(item);
            else this.queue.splice(index, 0, item);
            this.triggerProcessing();
          }
        }, retryDelay);
      } else {
        this.failedCount++;
      }
    } finally {
      this.activeJobs.delete(item.id);
      this.cancelledJobIds.delete(item.id);
      this.triggerProcessing();
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    this.isRunning = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
    }

    // Wait briefly for active jobs to finish
    if (this.activeJobs.size > 0) {
      logger.info({ activeJobsCount: this.activeJobs.size }, 'Waiting for active jobs to drain...');
      let attempts = 0;
      while (this.activeJobs.size > 0 && attempts < 10) {
        await new Promise((r) => setTimeout(r, 500));
        attempts++;
      }
    }
  }
}
