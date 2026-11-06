import os from 'node:os';
import type { QueueJobPayload } from './queue.interface.js';
import { getJobQueue } from './queue.factory.js';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { domainPolicyService } from '../core/domain/domain-policy.service.js';
import { crawlerFactory } from '../crawlers/crawler.factory.js';
import type { CrawlJobInput } from '../crawlers/crawler.interface.js';
import type { ExtractionConfig } from '../extraction/schemas/extraction.schema.js';
import { logger } from '../monitoring/logger.js';
import { proxyService } from '../proxies/proxy.service.js';
import { ENV } from '../config/env.js';
import { LocalWorkerPool } from './local-worker-pool.js';

const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;

export class ScrapingWorker {
  private queue: ReturnType<typeof getJobQueue> | null = null;
  private pool: LocalWorkerPool | null = null;
  private isStopping = false;

  async start(): Promise<void> {
    logger.info({ workerId: WORKER_ID }, 'Starting scraping worker process');

    this.queue = getJobQueue();
    if (ENV.QUEUE_ADAPTER === 'memory') {
      this.pool = new LocalWorkerPool(ENV.LOCAL_WORKER_PROCESSES);
      await this.pool.start();
    }
    await this.queue.startProcessing(async (payload: QueueJobPayload) => {
      if (this.pool) await this.pool.execute(payload, () => this.queue!.isJobCancelled(payload.jobId));
      else await this.processJob(payload, () => this.queue!.isJobCancelled(payload.jobId));
    });
  }

  async processJob(payload: QueueJobPayload, isCancelled: () => boolean = () => false): Promise<void> {
    const { jobId } = payload;
    const jobLog = logger.child({ jobId, workerId: WORKER_ID });

    // 1. Fetch current job state
    const job = await jobRepository.getJobById(jobId);
    if (!job) {
      jobLog.warn('Job not found in database. Skipping');
      return;
    }

    if (job.status === 'CANCELLED' || isCancelled()) {
      jobLog.info('Job was cancelled. Skipping execution');
      return;
    }

    // 2. Create JobAttempt record
    const attemptNumber = (job.attempts[0]?.attemptNumber ?? 0) + 1;
    const attempt = await jobRepository.createAttempt(jobId, attemptNumber, WORKER_ID);

    // 3. Mark job as RUNNING
    await jobRepository.updateJobStatus(jobId, 'RUNNING', {
      startedAt: job.startedAt || new Date(),
    });

    jobLog.info({ attempt: attemptNumber, targetUrl: job.targetUrl }, 'Beginning crawl execution');

    try {
      // 4. Retrieve domain policy settings
      const policy = await domainPolicyService.getPolicy(job.domain);
      if (!policy.allowed) {
        throw new Error(`Domain '${job.domain}' is disallowed by domain policy.`);
      }

      let parsedConfig: ExtractionConfig;
      try {
        parsedConfig = JSON.parse(job.extractionConfig);
      } catch {
        parsedConfig = {} as ExtractionConfig;
      }

      const proxyUrl = job.proxyId ? await proxyService.resolveUrl(job.proxyId) : null;
      if (job.proxyId && !proxyUrl) throw new Error('The selected proxy no longer exists');

      const crawlInput: CrawlJobInput = {
        jobId: job.id,
        targetUrl: job.targetUrl,
        domain: job.domain,
        strategy: job.strategy as 'AUTO' | 'CHEERIO' | 'PLAYWRIGHT',
        maxDepth: job.maxDepth,
        maxPages: job.maxPages,
        requestTimeoutMs: job.requestTimeoutMs,
        retryLimit: job.retryLimit,
        proxyUrl: proxyUrl ?? undefined,
        extractionConfig: parsedConfig,
        minDelayMs: policy.minDelayMs,
        maxConcurrency: policy.maxConcurrency,
      };

      // 5. Select crawler runner
      const { runner, resolvedStrategy } = await crawlerFactory.getCrawler(crawlInput);
      jobLog.info({ resolvedStrategy }, 'Selected crawler strategy');

      // 6. Run crawler with cancellation callback
      const summary = await runner.run(crawlInput, () => isCancelled() || this.isStopping);

      // Check if job was cancelled during crawl
      if (isCancelled()) {
        await jobRepository.updateJobStatus(jobId, 'CANCELLED', {
          finishedAt: new Date(),
          errorMessage: 'Job cancelled by user request during execution',
        });
        await jobRepository.updateAttempt(attempt.id, 'FAILED', 'Cancelled by user');
        jobLog.info('Crawl ended due to user cancellation');
        return;
      }

      // 7. Complete job attempt & job record
      await jobRepository.updateAttempt(
        attempt.id,
        summary.status === 'FAILED' ? 'FAILED' : 'COMPLETED',
        summary.errors.length > 0 ? summary.errors.join('; ') : undefined
      );

      await jobRepository.updateJobStatus(jobId, summary.status, {
        finishedAt: new Date(),
        errorMessage: summary.errors.length > 0 ? summary.errors.join('; ') : null,
      });

      jobLog.info(
        {
          status: summary.status,
          pagesCrawled: summary.totalPagesCrawled,
          resultsExtracted: summary.totalResultsExtracted,
          durationMs: summary.durationMs,
        },
        'Job crawl execution completed'
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      jobLog.error({ error: errorMsg }, 'Fatal error during job crawl execution');

      await jobRepository.updateAttempt(attempt.id, 'FAILED', errorMsg);
      await jobRepository.updateJobStatus(jobId, 'FAILED', {
        finishedAt: new Date(),
        errorMessage: errorMsg,
      });

      throw err; // Re-throw so queue can manage retry logic
    }
  }

  async stop(): Promise<void> {
    this.isStopping = true;
    logger.info('Stopping scraping worker');
    await this.queue?.close();
    await this.pool?.close();
  }
}

export const scrapingWorker = new ScrapingWorker();
