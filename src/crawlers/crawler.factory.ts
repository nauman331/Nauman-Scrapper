import { load } from 'cheerio';
import type { ICrawlerRunner, CrawlJobInput } from './crawler.interface.js';
import { CheerioCrawlerRunner } from './cheerio.crawler.js';
import { PlaywrightCrawlerRunner } from './playwright.crawler.js';
import { validateUrlForSsrf } from '../core/ssrf/ssrf-validator.js';
import { logger } from '../monitoring/logger.js';

/** Pure startup heuristic: framework assets alone do not imply client rendering. */
export function requiresBrowserRendering(html: string, status = 200): boolean {
  if (status >= 400) return true;

  const $ = load(html);
  $('script, style, template, noscript, [hidden], [aria-hidden="true"]').remove();
  const body = $('body');
  const text = body.text().replace(/\s+/g, ' ').trim();
  const title = $('title').text();
  const challengeText = `${title} ${text}`;
  if (/just a moment|checking your browser|verify (?:that )?you are human|access denied|enable javascript and cookies|attention required|security verification/i.test(challengeText)) {
    return true;
  }

  // Count actual body content, not head metadata, script payloads, or empty wrappers.
  const hasContent = text.length >= 120 || body.find('img[src], picture source[srcset], video[src], table td, input:not([type="hidden"]), textarea, select').length > 0;
  if (hasContent) return false;

  const hasFramework = /_next\/static|__next_data__|__nuxt|data-reactroot|<app-root\b/i.test(html)
    || body.find('#__next, #root, #app, app-root, [data-reactroot]').length > 0;
  const jsPrompt = /(?:enable|requires?) javascript|javascript (?:is )?(?:required|disabled)/i.test(text);
  return hasFramework || jsPrompt || text.length === 0;
}

class ProbeSsrfError extends Error {}

async function assertSafeProbeUrl(url: string): Promise<void> {
  const validation = await validateUrlForSsrf(url);
  if (!validation.valid) {
    throw new ProbeSsrfError(`Blocked by SSRF policy: ${validation.error ?? url}`);
  }
}

export class CrawlerFactory {
  private cheerioRunner = new CheerioCrawlerRunner();
  private playwrightRunner = new PlaywrightCrawlerRunner();

  async getCrawler(job: CrawlJobInput): Promise<{ runner: ICrawlerRunner; resolvedStrategy: 'CHEERIO' | 'PLAYWRIGHT' }> {
    if (job.strategy === 'CHEERIO') {
      return { runner: this.cheerioRunner, resolvedStrategy: 'CHEERIO' };
    }
    if (job.strategy === 'PLAYWRIGHT') {
      return { runner: this.playwrightRunner, resolvedStrategy: 'PLAYWRIGHT' };
    }

    const hostname = new URL(job.targetUrl).hostname.toLowerCase();
    const isReddit = hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
    // Native fetch has no reusable proxy client here: never probe a proxy job directly.
    // Even server-rendered HTML can hide sections behind runtime scroll observers.
    // AUTO HTML capture always uses the browser, but must still validate its target.
    const skipProbe = Boolean(job.extractionConfig.extractHtml) || Boolean(job.proxyUrl) || isReddit;
    if (skipProbe) await assertSafeProbeUrl(job.targetUrl);
    const requiresBrowser = skipProbe || await this.detectJsRequirement(job.targetUrl, job.requestTimeoutMs);
    const resolvedStrategy = requiresBrowser ? 'PLAYWRIGHT' : 'CHEERIO';
    logger.info({ jobId: job.jobId, url: job.targetUrl, resolvedStrategy }, 'Auto-detection selected crawler strategy');
    return {
      runner: requiresBrowser ? this.playwrightRunner : this.cheerioRunner,
      resolvedStrategy,
    };
  }

  private async detectJsRequirement(url: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const budgetMs = Math.max(1, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000));
    const timeout = setTimeout(() => controller.abort(), budgetMs);
    let validatingUrl = false;
    try {
      // Race also bounds a stalled mocked/client body read or DNS validation; fetch's
      // abort signal remains active until the entire probe (including body) finishes.
      const probe = async (): Promise<boolean> => {
        let currentUrl = url;
        for (let redirects = 0; redirects <= 5; redirects++) {
          validatingUrl = true;
          await assertSafeProbeUrl(currentUrl);
          validatingUrl = false;
          controller.signal.throwIfAborted();
          const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml',
            },
            signal: controller.signal,
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location || redirects === 5) return true;
            currentUrl = new URL(location, currentUrl).href;
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            return true;
          }
          const contentType = response.headers.get('content-type');
          if (contentType && !/html|xhtml/i.test(contentType)) {
            await response.body?.cancel();
            return false;
          }
          return requiresBrowserRendering(await response.text(), response.status);
        }
        return true;
      };
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Startup probe timed out')), { once: true });
      });
      return await Promise.race([probe(), aborted]);
    } catch (error) {
      // A policy rejection is a job failure, never an invitation to try a browser.
      if (error instanceof ProbeSsrfError) throw error;
      if (validatingUrl) {
        throw new ProbeSsrfError('Blocked by SSRF policy: startup URL validation did not complete');
      }
      logger.debug({ url, error }, 'Startup probe inconclusive; selecting browser');
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const crawlerFactory = new CrawlerFactory();
