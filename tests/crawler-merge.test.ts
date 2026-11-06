import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrawlJobInput } from '../src/crawlers/crawler.interface.js';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), snapshot: vi.fn(), readiness: vi.fn(), extract: vi.fn(),
  save: vi.fn(), add: vi.fn(), drop: vi.fn(), options: undefined as any,
}));
vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: mocks.validate }));
vi.mock('../src/monitoring/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/core/domain/domain-policy.service.js', () => ({ domainPolicyService: { paceRequest: vi.fn() } }));
vi.mock('../src/crawlers/cheerio.crawler.js', () => ({ CheerioCrawlerRunner: class {} }));
vi.mock('../src/crawlers/render-readiness.js', () => ({ waitForRenderedContent: mocks.readiness }));
vi.mock('../src/crawlers/rendered-snapshot.js', () => ({ captureRenderedHtml: mocks.snapshot }));
vi.mock('../src/extraction/pipeline.js', () => ({ runExtractionPipeline: mocks.extract }));
vi.mock('../src/persistence/repositories/result.repository.js', () => ({ resultRepository: {
  saveCrawledPage: vi.fn().mockResolvedValue({ id: 'page' }), saveResultIdempotent: mocks.save,
} }));
vi.mock('../src/persistence/repositories/job.repository.js', () => ({ jobRepository: { incrementCounts: vi.fn() } }));
vi.mock('crawlee', () => ({
  LogLevel: { WARNING: 1 }, log: { setLevel: vi.fn() }, ProxyConfiguration: class {},
  RequestQueue: { open: vi.fn(async () => ({ addRequest: mocks.add, drop: mocks.drop })) },
  PlaywrightCrawler: class {
    constructor(options: unknown) { mocks.options = options; }
    async run() {}
  },
}));

import { CrawlerFactory } from '../src/crawlers/crawler.factory.js';
import { PlaywrightCrawlerRunner } from '../src/crawlers/playwright.crawler.js';

const job = (extractHtml: boolean): CrawlJobInput => ({
  jobId: 'merge-test', targetUrl: 'https://public.org/', domain: 'public.org', strategy: 'AUTO',
  maxDepth: 1, maxPages: 2, requestTimeoutMs: 15000, retryLimit: 0,
  extractionConfig: { extractHtml, extractImages: true } as CrawlJobInput['extractionConfig'],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockResolvedValue({ valid: true });
  mocks.add.mockResolvedValue({ wasAlreadyPresent: false });
  mocks.snapshot.mockResolvedValue('<html>rendered snapshot</html>');
  mocks.readiness.mockResolvedValue(undefined);
  mocks.extract.mockImplementation((html: string) => ({
    normalizedData: { html, metadata: { title: 'Legacy title' } },
    validation: { passed: true, errors: [] },
    discoveredUrls: ['https://public.org/a', 'https://public.org/b', 'https://public.org/c'],
  }));
});

function page() {
  const events: string[] = [];
  return {
    events, url: () => 'https://public.org/', viewportSize: () => ({ width: 1000, height: 600 }),
    waitForLoadState: vi.fn().mockResolvedValue(undefined), waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (_callback, arg) => { events.push(typeof arg === 'number' ? 'fonts' : arg ? 'scroll' : 'cssom'); }),
    content: vi.fn().mockResolvedValue('<html>legacy DOM</html>'), addInitScript: vi.fn(), route: vi.fn(),
  };
}
const request = { url: 'https://public.org/', userData: { depth: 0 } };

describe('crawler merge contracts', () => {
  it('validates AUTO HTML targets without probing and fails closed on unsafe targets', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      expect((await new CrawlerFactory().getCrawler(job(true))).resolvedStrategy).toBe('PLAYWRIGHT');
      expect(mocks.validate).toHaveBeenCalledWith(job(true).targetUrl);
      mocks.validate.mockResolvedValue({ valid: false, error: 'private IP' });
      await expect(new CrawlerFactory().getCrawler(job(true))).rejects.toThrow('SSRF');
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it('prepares fonts/CSSOM before the responsive snapshot and retains additive metadata and the bounded queue', async () => {
    await new PlaywrightCrawlerRunner().run(job(true));
    const browserPage = page();
    await mocks.options.preNavigationHooks[0]({ page: browserPage, request });
    expect(mocks.validate).toHaveBeenCalledWith(request.url);
    expect(browserPage.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    await mocks.options.requestHandler({ page: browserPage, request });
    expect(mocks.readiness).toHaveBeenCalledWith(browserPage, expect.any(Number));
    expect(browserPage.events).toEqual(['fonts', 'cssom']);
    expect(browserPage.evaluate.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.snapshot.mock.invocationCallOrder[0]);
    expect(browserPage.content).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][0].normalizedData).toMatchObject({
      html: '<html>rendered snapshot</html>', metadata: { title: 'Legacy title' },
      capture: { version: 1, strategy: 'PLAYWRIGHT', snapshot: 'rendered-dom', readiness: 'bounded-scroll', viewport: { width: 1000, height: 600 } },
    });
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenLastCalledWith({ url: 'https://public.org/a', userData: { depth: 1 } });
    expect(mocks.drop).toHaveBeenCalledOnce();
  });

  it('keeps legacy data-only content capture without snapshot metadata', async () => {
    await new PlaywrightCrawlerRunner().run(job(false));
    const browserPage = page();
    await mocks.options.requestHandler({ page: browserPage, request });
    expect(browserPage.events).toEqual(['scroll']);
    expect(browserPage.content).toHaveBeenCalledOnce();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][0].normalizedData).not.toHaveProperty('capture');
  });

  it('does not persist a successful HTML snapshot after readiness failure', async () => {
    await new PlaywrightCrawlerRunner().run(job(true));
    mocks.readiness.mockRejectedValueOnce(new Error('page interrupted'));
    await expect(mocks.options.requestHandler({ page: page(), request })).rejects.toThrow('page interrupted');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
