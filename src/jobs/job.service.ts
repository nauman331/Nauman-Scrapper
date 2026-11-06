import type { CreateJobRequest, ListJobsQuery } from './job.types.js';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { resultRepository } from '../persistence/repositories/result.repository.js';
import { getJobQueue } from '../queue/queue.factory.js';
import { validateUrlForSsrf } from '../core/ssrf/ssrf-validator.js';
import { domainPolicyService } from '../core/domain/domain-policy.service.js';
import { normalizeUrl } from '../core/domain/url-normalizer.js';
import { logger } from '../monitoring/logger.js';
import { proxyService } from '../proxies/proxy.service.js';
import { aggregateCleanData, type CleanDataPage } from '../extraction/clean-data.js';
import type { NormalizedPageData } from '../extraction/schemas/extraction.schema.js';

export class JobService {
  private queue = getJobQueue();

  /**
   * Validates target URL for SSRF, creates persistent job record, and enqueues to durable queue
   */
  async createJob(input: CreateJobRequest) {
    // 1. SSRF and protocol validation
    const ssrfResult = await validateUrlForSsrf(input.targetUrl);
    if (!ssrfResult.valid || !ssrfResult.domain) {
      throw new Error(`Target URL rejected: ${ssrfResult.error || 'Invalid destination'}`);
    }

    const normalizedTargetUrl = normalizeUrl(input.targetUrl);
    const domain = ssrfResult.domain;

    // 2. Fetch or create domain policy
    const policy = await domainPolicyService.getPolicy(domain);
    if (!policy.allowed) {
      throw new Error(`Domain '${domain}' is explicitly disallowed by domain policy.`);
    }

    if (input.proxyId) await proxyService.assertExists(input.proxyId);

    // 3. Persist job in database
    const job = await jobRepository.createJob({
      name: input.name,
      targetUrl: normalizedTargetUrl,
      domain,
      strategy: input.strategy,
      proxyId: input.proxyId,
      priority: input.priority,
      maxDepth: input.maxDepth,
      maxPages: input.maxPages,
      requestTimeoutMs: input.requestTimeoutMs,
      retryLimit: input.retryLimit,
      extractionConfig: JSON.stringify(input.extractionConfig),
    });

    // 4. Dispatch to queue
    await this.queue.addJob(
      job.id,
      {
        jobId: job.id,
        targetUrl: job.targetUrl,
        domain: job.domain,
        priority: job.priority,
        retryLimit: job.retryLimit,
      },
      job.priority
    );

    logger.info({ jobId: job.id, targetUrl: job.targetUrl, domain }, 'Scrape job successfully created and enqueued');

    return job;
  }

  async getJob(id: string) {
    const job = await jobRepository.getJobById(id);
    if (!job) {
      return null;
    }

    return {
      ...job,
      extractionConfig: JSON.parse(job.extractionConfig),
    };
  }

  async listJobs(query: ListJobsQuery) {
    return jobRepository.listJobs(query);
  }

  async cancelJob(id: string) {
    const job = await jobRepository.getJobById(id);
    if (!job) {
      return false;
    }

    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      return false;
    }

    await this.queue.cancelJob(id);
    await jobRepository.updateJobStatus(id, 'CANCELLED', {
      finishedAt: new Date(),
      errorMessage: 'Cancelled by user request',
    });

    logger.info({ jobId: id }, 'Job successfully cancelled');
    return true;
  }

  async retryJob(id: string) {
    const job = await jobRepository.getJobById(id);
    if (!job) {
      throw new Error(`Job '${id}' not found`);
    }

    if (job.status !== 'FAILED' && job.status !== 'CANCELLED' && job.status !== 'PARTIALLY_COMPLETED') {
      throw new Error(`Only failed, cancelled, or partially completed jobs can be retried. Current status: ${job.status}`);
    }

    // Reset status to PENDING
    await jobRepository.updateJobStatus(id, 'PENDING', {
      errorMessage: null,
      finishedAt: null,
    });

    // Re-enqueue
    await this.queue.addJob(
      job.id,
      {
        jobId: job.id,
        targetUrl: job.targetUrl,
        domain: job.domain,
        priority: job.priority,
        retryLimit: job.retryLimit,
      },
      job.priority
    );

    logger.info({ jobId: id }, 'Job reset and re-enqueued for retry');
    return jobRepository.getJobById(id);
  }

  async getJobResults(
    id: string,
    options: { limit?: number; offset?: number; validationPassed?: boolean } = {}
  ) {
    const job = await jobRepository.getJobById(id);
    if (!job) {
      return null;
    }
    return resultRepository.getResultsByJobId(id, options);
  }

  async getJobPages(id: string, options: { limit?: number; offset?: number } = {}) {
    const job = await jobRepository.getJobById(id);
    if (!job) return null;
    return resultRepository.getCrawledPagesByJobId(id, options);
  }

  async getCleanData(id: string) {
    const job = await jobRepository.getJobById(id);
    if (!job) return null;
    const pages: CleanDataPage[] = [];
    let offset = 0;
    let total = 0;
    do {
      const batch = await resultRepository.getResultsByJobId(id, { limit: 200, offset });
      for (const item of batch.items) {
        if (item.rawData && typeof item.rawData === 'object') pages.push({ url: item.url, rawData: item.rawData as NormalizedPageData });
      }
      total = batch.total;
      offset += batch.items.length;
      if (!batch.items.length) break;
    } while (offset < total && offset < 500);
    return aggregateCleanData(pages, job.targetUrl);
  }

  /**
   * Startup recovery: marks orphaned 'RUNNING' jobs from previous crashes as FAILED
   * so they are clearly visible and can be reprocessed if desired.
   */
  async recoverOrphanedJobs(): Promise<void> {
    const runningJobs = await jobRepository.listJobs({ status: 'RUNNING', limit: 100 });
    if (runningJobs.items.length > 0) {
      logger.warn(
        { count: runningJobs.items.length },
        'Found orphaned RUNNING jobs from previous process. Updating to FAILED for clean recovery'
      );
      for (const job of runningJobs.items) {
        await jobRepository.updateJobStatus(job.id, 'FAILED', {
          finishedAt: new Date(),
          errorMessage: 'Process restarted unexpectedly while job was running',
        });
      }
    }
  }
}

export const jobService = new JobService();

