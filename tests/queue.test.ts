import { describe, it, expect } from 'vitest';
import { MemoryJobQueue } from '../src/queue/memory.queue.js';
import type { QueueJobPayload } from '../src/queue/queue.interface.js';

describe('Durable In-Memory Queue', () => {
  it('should process higher priority jobs ahead of lower priority jobs', async () => {
    const queue = new MemoryJobQueue(1); // Concurrency 1 for deterministic sequential check
    const processedOrder: string[] = [];

    const jobLow: QueueJobPayload = {
      jobId: 'job-low',
      targetUrl: 'https://example.com/low',
      domain: 'example.com',
      priority: 1,
      retryLimit: 1,
    };

    const jobHigh: QueueJobPayload = {
      jobId: 'job-high',
      targetUrl: 'https://example.com/high',
      domain: 'example.com',
      priority: 10,
      retryLimit: 1,
    };

    const jobMedium: QueueJobPayload = {
      jobId: 'job-medium',
      targetUrl: 'https://example.com/med',
      domain: 'example.com',
      priority: 5,
      retryLimit: 1,
    };

    await queue.addJob(jobLow.jobId, jobLow, jobLow.priority);
    await queue.addJob(jobHigh.jobId, jobHigh, jobHigh.priority);
    await queue.addJob(jobMedium.jobId, jobMedium, jobMedium.priority);

    await queue.startProcessing(async (payload) => {
      processedOrder.push(payload.jobId);
    });

    // Wait for queue to drain
    await new Promise((r) => setTimeout(r, 200));

    expect(processedOrder).toEqual(['job-high', 'job-medium', 'job-low']);
    await queue.close();
  });

  it('should cancel waiting jobs and report accurate metrics', async () => {
    const queue = new MemoryJobQueue(1);

    const payload: QueueJobPayload = {
      jobId: 'job-cancel-test',
      targetUrl: 'https://example.com/cancel',
      domain: 'example.com',
      priority: 0,
      retryLimit: 1,
    };

    await queue.addJob(payload.jobId, payload, 0);

    const cancelled = await queue.cancelJob('job-cancel-test');
    expect(cancelled).toBe(true);
    expect(queue.isJobCancelled('job-cancel-test')).toBe(true);

    const metrics = await queue.getQueueMetrics();
    expect(metrics.waiting).toBe(0);

    await queue.close();
  });
});
