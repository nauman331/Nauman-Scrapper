import { CheerioCrawler, RequestQueue, LogLevel, log, ProxyConfiguration } from 'crawlee';
import type { CrawlJobInput, CrawlExecutionSummary, ICrawlerRunner } from './crawler.interface.js';
import { runExtractionPipeline } from '../extraction/pipeline.js';
import { resultRepository } from '../persistence/repositories/result.repository.js';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { validateUrlForSsrf } from '../core/ssrf/ssrf-validator.js';
import { domainPolicyService } from '../core/domain/domain-policy.service.js';
import { logger } from '../monitoring/logger.js';
import { createBoundedEnqueue } from './bounded-request-queue.js';

// Configure Crawlee log level to suppress verbose internal logs
log.setLevel(LogLevel.WARNING);

export class CheerioCrawlerRunner implements ICrawlerRunner {
  async run(job: CrawlJobInput, isCancelled: () => boolean = () => false): Promise<CrawlExecutionSummary> {
    const startTime = Date.now();
    let pagesCrawled = 0;
    let resultsExtracted = 0;
    let failedPages = 0;
    const errors: string[] = [];

    // Crawlee's local RequestQueue for this job run
    const requestQueue = await RequestQueue.open(`job-${job.jobId}-${Date.now()}`);

    // Add target root URL with initial depth 0
    const enqueue = createBoundedEnqueue(requestQueue, job.maxPages);
    await enqueue(job.targetUrl, 0);

    const timeoutSecs = Math.max(5, Math.ceil(job.requestTimeoutMs / 1000));
    const minDelay = job.minDelayMs ?? 500;
    const maxConcurrency = job.maxConcurrency ?? 3;

    const crawler = new CheerioCrawler({
      requestQueue,
      proxyConfiguration: job.proxyUrl ? new ProxyConfiguration({ proxyUrls: [job.proxyUrl] }) : undefined,
      maxRequestsPerCrawl: job.maxPages,
      maxRequestRetries: job.retryLimit,
      requestHandlerTimeoutSecs: timeoutSecs,
      maxConcurrency,

      async requestHandler({ request, $, response }) {
        if (isCancelled()) {
          logger.info({ jobId: job.jobId }, 'Crawl execution cancelled by user request');
          await crawler.autoscaledPool?.abort();
          return;
        }

        const currentUrl = request.loadedUrl || request.url;
        const currentDepth = (request.userData.depth as number) ?? 0;
        const reqStart = Date.now();

        // 1. SSRF re-check on loaded/redirected URL
        const ssrfCheck = await validateUrlForSsrf(currentUrl);
        if (!ssrfCheck.valid) {
          logger.warn({ url: currentUrl, error: ssrfCheck.error }, 'SSRF blocked crawled request');
          failedPages++;
          errors.push(`Blocked by SSRF policy: ${currentUrl}`);
          return;
        }

        // 2. Pace domain request according to domain policy
        await domainPolicyService.paceRequest(job.domain, minDelay);

        const html = $.html();
        const durationMs = Date.now() - reqStart;
        const byteSize = Buffer.byteLength(html, 'utf8');

        // 3. Extract and normalize data
        const extracted = runExtractionPipeline(html, currentUrl, job.extractionConfig);

        // 4. Save CrawledPage operational log
        const crawledPage = await resultRepository.saveCrawledPage({
          jobId: job.jobId,
          url: currentUrl,
          canonicalUrl: extracted.normalizedData.metadata?.canonicalUrl,
          httpStatus: response.statusCode,
          responseTimeMs: durationMs,
          contentType: response.headers['content-type'],
          byteSize,
          depth: currentDepth,
          crawlerStrategy: 'CHEERIO',
        });

        // 5. Idempotent result persistence
        await resultRepository.saveResultIdempotent({
          jobId: job.jobId,
          crawledPageId: crawledPage.id,
          url: currentUrl,
          normalizedData: extracted.normalizedData,
          validation: extracted.validation,
        });

        pagesCrawled++;
        resultsExtracted++;

        // Update counts in job record
        await jobRepository.incrementCounts(job.jobId, {
          totalPagesCrawled: 1,
          totalResultsExtracted: 1,
        });

        // 6. Enqueue discovered URLs if within maxDepth
        if (currentDepth < job.maxDepth && extracted.discoveredUrls.length > 0) {
          for (const nextUrl of extracted.discoveredUrls) {
            if (!(await enqueue(nextUrl, currentDepth + 1))) break;
          }
        }
      },

      failedRequestHandler({ request }, error) {
        failedPages++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed URL ${request.url}: ${errorMsg}`);
        logger.warn({ jobId: job.jobId, url: request.url, error: errorMsg }, 'CheerioCrawler request failed');

        // Record failure in CrawledPage
        resultRepository
          .saveCrawledPage({
            jobId: job.jobId,
            url: request.url,
            depth: (request.userData.depth as number) ?? 0,
            crawlerStrategy: 'CHEERIO',
            error: errorMsg,
          })
          .catch((e) => logger.error({ error: e }, 'Failed to record failed page log'));
      },
    });

    try {
      await crawler.run();
    } finally {
      // Clean up Crawlee request queue
      await requestQueue.drop();
    }

    const durationMs = Date.now() - startTime;
    let finalStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' = 'COMPLETED';

    if (pagesCrawled === 0 && failedPages > 0) {
      finalStatus = 'FAILED';
    } else if (failedPages > 0) {
      finalStatus = 'PARTIALLY_COMPLETED';
    }

    return {
      jobId: job.jobId,
      totalPagesCrawled: pagesCrawled,
      totalResultsExtracted: resultsExtracted,
      failedPages,
      durationMs,
      status: finalStatus,
      errors: errors.slice(0, 20),
    };
  }
}
