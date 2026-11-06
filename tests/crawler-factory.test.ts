import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
vi.mock('../src/crawlers/cheerio.crawler.js', () => ({ CheerioCrawlerRunner: class {} }));
vi.mock('../src/crawlers/playwright.crawler.js', () => ({ PlaywrightCrawlerRunner: class {} }));
import { CrawlerFactory } from '../src/crawlers/crawler.factory.js';
import type { CrawlJobInput } from '../src/crawlers/crawler.interface.js';

const job = (strategy: CrawlJobInput['strategy'], extractHtml: boolean): CrawlJobInput => ({
  jobId: 'test', targetUrl: 'https://site.test', domain: 'site.test', strategy,
  maxDepth: 0, maxPages: 1, requestTimeoutMs: 30000, retryLimit: 0,
  extractionConfig: { extractHtml } as CrawlJobInput['extractionConfig'],
});

describe('Rendered HTML crawler selection', () => {
  it('uses a browser for AUTO HTML capture without relying on empty-SPA detection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      expect((await new CrawlerFactory().getCrawler(job('AUTO', true))).resolvedStrategy).toBe('PLAYWRIGHT');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it('respects explicit data-only and crawler choices', async () => {
    const factory = new CrawlerFactory();
    expect((await factory.getCrawler(job('CHEERIO', true))).resolvedStrategy).toBe('CHEERIO');
    expect((await factory.getCrawler(job('PLAYWRIGHT', false))).resolvedStrategy).toBe('PLAYWRIGHT');
  });
});
