import { prisma } from '../persistence/prisma.js';
import { getJobQueue } from '../queue/queue.factory.js';
import { ENV } from '../config/env.js';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptimeSeconds: number;
  memoryUsageMb: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
}

export interface ReadinessCheckResult extends HealthCheckResult {
  checks: {
    database: { status: 'up' | 'down'; latencyMs?: number; error?: string };
    queue: { status: 'up' | 'down'; adapter: string; metrics?: unknown; error?: string };
  };
}

export class HealthService {
  private startTime = Date.now();

  getLiveness(): HealthCheckResult {
    const memory = process.memoryUsage();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memoryUsageMb: {
        rss: Math.round(memory.rss / (1024 * 1024)),
        heapTotal: Math.round(memory.heapTotal / (1024 * 1024)),
        heapUsed: Math.round(memory.heapUsed / (1024 * 1024)),
      },
    };
  }

  async getReadiness(): Promise<ReadinessCheckResult> {
    const liveness = this.getLiveness();
    const result: ReadinessCheckResult = {
      ...liveness,
      checks: {
        database: { status: 'down' },
        queue: { status: 'down', adapter: ENV.QUEUE_ADAPTER },
      },
    };

    // 1. Check Database
    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      result.checks.database = {
        status: 'up',
        latencyMs: Date.now() - dbStart,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.checks.database = {
        status: 'down',
        error: msg,
      };
      result.status = 'error';
    }

    // 2. Check Queue
    try {
      const queue = getJobQueue();
      const metrics = await queue.getQueueMetrics();
      result.checks.queue = {
        status: 'up',
        adapter: ENV.QUEUE_ADAPTER,
        metrics,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.checks.queue = {
        status: 'down',
        adapter: ENV.QUEUE_ADAPTER,
        error: msg,
      };
      result.status = 'error';
    }

    return result;
  }
}

export const healthService = new HealthService();
