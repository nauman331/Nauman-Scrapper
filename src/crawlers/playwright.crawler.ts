import { PlaywrightCrawler, RequestQueue, LogLevel, log, ProxyConfiguration } from 'crawlee';
import type { CrawlJobInput, CrawlExecutionSummary, ICrawlerRunner } from './crawler.interface.js';
import { runExtractionPipeline } from '../extraction/pipeline.js';
import { resultRepository } from '../persistence/repositories/result.repository.js';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { validateUrlForSsrf } from '../core/ssrf/ssrf-validator.js';
import { domainPolicyService } from '../core/domain/domain-policy.service.js';
import { logger } from '../monitoring/logger.js';
import { createBoundedEnqueue } from './bounded-request-queue.js';
import { captureRenderedHtml } from './rendered-snapshot.js';
import { waitForRenderedContent as waitForSnapshotReadiness } from './render-readiness.js';

log.setLevel(LogLevel.WARNING);

const MAX_AUTO_SCROLLS = 12;
const SCROLL_SETTLE_MS = 650;
const FONT_READY_TIMEOUT_MS = 2000;

export async function routeBrowserRequest(
  route: import('playwright').Route,
  config: { extractHtml: boolean; extractImages: boolean }
): Promise<void> {
  const request = route.request();
  const resourceType = request.resourceType();
  if (resourceType === 'media' || (resourceType === 'font' && !config.extractHtml)
    || (resourceType === 'image' && !config.extractImages)) {
    await route.abort();
    return;
  }

  try {
    const url = request.url();
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:') {
      // Recheck every request (including redirects), without a hostname cache or private-network bypass.
      const check = await validateUrlForSsrf(url, false);
      if (!check.valid) {
        await route.abort('blockedbyclient');
        return;
      }
    }
  } catch {
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

export async function prepareHtmlCapture(page: import('playwright').Page): Promise<void> {
  await page.evaluate(async (timeoutMs) => {
    if (!document.fonts) return;
    let timer: number | undefined;
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => { timer = window.setTimeout(resolve, timeoutMs); }),
      ]);
    } catch {
      // A failed font load must not prevent capturing the rendered document.
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }, FONT_READY_TIMEOUT_MS).catch(() => {});

  await page.evaluate(() => {
    // Preserve owner elements and cascade order; external sheets remain links, not duplicated inline CSS.
    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode;
      if (!owner || owner.nodeName !== 'STYLE' || sheet.href) continue;
      try {
        const cssText = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
        if (owner.textContent !== cssText) owner.textContent = cssText;
      } catch {
        // Cross-origin/inaccessible rules leave the original style text intact.
      }
    }
  }).catch(() => {});
}

export async function waitForRenderedContent(page: import('playwright').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#__next, #root, #app, app-root, [data-reactroot]')
        ?? document.querySelector('main') ?? document.body;
      if (!root) return false;
      // Empty nested divs and body script tags are not evidence of hydration.
      const content = root.cloneNode(true) as Element;
      content.querySelectorAll('script, style, template, noscript, [hidden], [aria-hidden="true"]').forEach((node) => node.remove());
      return (content.textContent || '').replace(/\s+/g, ' ').trim().length > 30
        || content.querySelector('img[src], picture source[srcset], video[src], table td, input:not([type="hidden"]), textarea, select') !== null;
    },
    undefined,
    { timeout: 5000 }
  );
}

export async function loadLazyContent(page: import('playwright').Page): Promise<void> {
  await page.evaluate(
    async ({ maxScrolls, settleMs }) => {
      const originalX = window.scrollX;
      const originalY = window.scrollY;
      let previousHeight = document.documentElement.scrollHeight;
      let unchangedRounds = 0;

      try {
        for (let index = 0; index < maxScrolls && unchangedRounds < 3; index++) {
          const viewportHeight = Math.max(1, window.innerHeight);
          const bottom = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
          const nextTop = Math.min(bottom, window.scrollY + Math.max(1, Math.floor(viewportHeight * 0.8)));
          window.scrollTo({ left: originalX, top: nextTop, behavior: 'instant' });
          await new Promise((resolve) => window.setTimeout(resolve, settleMs));

          const nextHeight = document.documentElement.scrollHeight;
          // Unchanged height alone is not a stopping condition while traversing a long static page.
          if (nextHeight <= previousHeight && window.scrollY >= Math.max(0, nextHeight - viewportHeight)) {
            unchangedRounds++;
          } else {
            unchangedRounds = 0;
          }
          previousHeight = nextHeight;
        }
      } finally {
        window.scrollTo({ left: originalX, top: originalY, behavior: 'instant' });
      }
    },
    { maxScrolls: MAX_AUTO_SCROLLS, settleMs: SCROLL_SETTLE_MS }
  );
}

export class PlaywrightCrawlerRunner implements ICrawlerRunner {
  async run(job: CrawlJobInput, isCancelled: () => boolean = () => false): Promise<CrawlExecutionSummary> {
    const startTime = Date.now();
    let pagesCrawled = 0;
    let resultsExtracted = 0;
    let failedPages = 0;
    const errors: string[] = [];

    const requestQueue = await RequestQueue.open(`pw-job-${job.jobId}-${Date.now()}`);

    const enqueue = createBoundedEnqueue(requestQueue, job.maxPages);
    await enqueue(job.targetUrl, 0);

    const timeoutSecs = Math.max(10, Math.ceil(job.requestTimeoutMs / 1000));
    const minDelay = job.minDelayMs ?? 1000;
    const maxConcurrency = Math.min(job.maxConcurrency ?? 2, 4); // Keep browser concurrency constrained

    const crawler = new PlaywrightCrawler({
      requestQueue,
      proxyConfiguration: job.proxyUrl ? new ProxyConfiguration({ proxyUrls: [job.proxyUrl] }) : undefined,
      maxRequestsPerCrawl: job.maxPages,
      maxRequestRetries: job.retryLimit,
      requestHandlerTimeoutSecs: timeoutSecs,
      maxConcurrency,

      // Memory-conscious Chromium configuration
      launchContext: {
        launchOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
          ],
        },
      },

      // Pre-navigation hook for stealth, memory & network optimization
      preNavigationHooks: [
        async ({ page, request }) => {
          const targetCheck = await validateUrlForSsrf(request.url);
          if (!targetCheck.valid) {
            throw new Error(`Blocked by SSRF policy: ${targetCheck.error ?? request.url}`);
          }
          // Reduce browser automation fingerprinting; challenge resolution is not guaranteed.
          await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          });

          // Conversion HTML needs fonts; every permitted network resource is SSRF-validated.
          await page.route('**/*', (route) => routeBrowserRequest(route, job.extractionConfig));
        },
      ],

      async requestHandler({ request, page, response }) {
        if (isCancelled()) {
          logger.info({ jobId: job.jobId }, 'Playwright crawl execution cancelled');
          await crawler.autoscaledPool?.abort();
          return;
        }

        const currentUrl = page.url() || request.url;
        const currentDepth = (request.userData.depth as number) ?? 0;
        const reqStart = Date.now();

        // 1. SSRF check on target page URL
        const ssrfCheck = await validateUrlForSsrf(currentUrl);
        if (!ssrfCheck.valid) {
          logger.warn({ url: currentUrl, error: ssrfCheck.error }, 'SSRF blocked Playwright page');
          failedPages++;
          errors.push(`Blocked by SSRF policy: ${currentUrl}`);
          return;
        }

        // 2. Pace domain request
        await domainPolicyService.paceRequest(job.domain, minDelay);

        // 3. Wait for DOM ready & React/Next.js client-side hydration
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

          // Wait for network requests (React Query, SWR, fetch) to settle
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

          // Explicitly wait for React, Next.js, or SPA mount container to be populated
          await waitForRenderedContent(page).catch(() => {});

          // HTML snapshots must visit intermediate sections before the footer:
          // jumping to the bottom can skip observers and reset reversible reveals.
          if (job.extractionConfig.extractHtml) {
            await waitForSnapshotReadiness(page, Math.min(20000, Math.max(2000, job.requestTimeoutMs - (Date.now() - reqStart) - 2000)));
          } else {
            // Keep bounded feed loading for ordinary data-only extraction.
            await loadLazyContent(page);
            await page.waitForTimeout(600);
          }
        } catch (error) {
          // Do not silently report an incomplete HTML clone as a successful capture.
          if (job.extractionConfig.extractHtml) throw error;
          logger.warn({ jobId: job.jobId, url: currentUrl, error }, 'Readiness failed; proceeding with data-only extraction');
        }

        if (job.extractionConfig.extractHtml) {
          await prepareHtmlCapture(page);
        }
        // Preserve data-only page.content() behavior; HTML clones retain adopted CSS
        // and the visible responsive/animation states observed during readiness.
        const html = job.extractionConfig.extractHtml
          ? await captureRenderedHtml(page)
          : await page.content();
        const durationMs = Date.now() - reqStart;
        const byteSize = Buffer.byteLength(html, 'utf8');

        // 4. Extract and normalize
        const extracted = runExtractionPipeline(html, currentUrl, job.extractionConfig);

        // 5. Save CrawledPage
        const crawledPage = await resultRepository.saveCrawledPage({
          jobId: job.jobId,
          url: currentUrl,
          canonicalUrl: extracted.normalizedData.metadata?.canonicalUrl,
          httpStatus: response?.status() ?? 200,
          responseTimeMs: durationMs,
          contentType: response?.headers()['content-type'] ?? 'text/html',
          byteSize,
          depth: currentDepth,
          crawlerStrategy: 'PLAYWRIGHT',
        });

        // Add capture provenance without moving legacy rawData.html or page metadata.
        // The repository serializes this additive field in rawData; existing readers
        // can continue to consume the unchanged NormalizedPageData fields.
        const normalizedData = job.extractionConfig.extractHtml
          ? {
            ...extracted.normalizedData,
            capture: {
              version: 1 as const,
              strategy: 'PLAYWRIGHT' as const,
              snapshot: 'rendered-dom' as const,
              readiness: 'bounded-scroll' as const,
              viewport: page.viewportSize(),
            },
          }
          : extracted.normalizedData;

        // 6. Idempotent result persistence
        await resultRepository.saveResultIdempotent({
          jobId: job.jobId,
          crawledPageId: crawledPage.id,
          url: currentUrl,
          normalizedData,
          validation: extracted.validation,
        });

        pagesCrawled++;
        resultsExtracted++;

        await jobRepository.incrementCounts(job.jobId, {
          totalPagesCrawled: 1,
          totalResultsExtracted: 1,
        });

        // 7. Enqueue discovered URLs
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
        logger.warn({ jobId: job.jobId, url: request.url, error: errorMsg }, 'PlaywrightCrawler request failed');

        resultRepository
          .saveCrawledPage({
            jobId: job.jobId,
            url: request.url,
            depth: (request.userData.depth as number) ?? 0,
            crawlerStrategy: 'PLAYWRIGHT',
            error: errorMsg,
          })
          .catch((e) => logger.error({ error: e }, 'Failed to record failed page log'));
      },
    });

    try {
      await crawler.run();
    } finally {
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
