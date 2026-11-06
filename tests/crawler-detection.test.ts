import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrawlJobInput } from '../src/crawlers/crawler.interface.js';
import type { Page } from 'playwright';

vi.mock('../src/crawlers/cheerio.crawler.js', () => ({ CheerioCrawlerRunner: class { run = vi.fn(); } }));
vi.mock('../src/crawlers/playwright.crawler.js', () => ({ PlaywrightCrawlerRunner: class { run = vi.fn(); } }));
vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn() }));
vi.mock('../src/monitoring/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
vi.mock('../src/persistence/repositories/result.repository.js', () => ({ resultRepository: {} }));
vi.mock('../src/persistence/repositories/job.repository.js', () => ({ jobRepository: {} }));
vi.mock('../src/core/domain/domain-policy.service.js', () => ({ domainPolicyService: {} }));
vi.mock('../src/extraction/pipeline.js', () => ({ runExtractionPipeline: vi.fn() }));

import { CrawlerFactory, requiresBrowserRendering } from '../src/crawlers/crawler.factory.js';
import { validateUrlForSsrf } from '../src/core/ssrf/ssrf-validator.js';

const job: CrawlJobInput = {
  jobId: 'detection-test', targetUrl: 'https://public.com/', domain: 'public.com',
  strategy: 'AUTO', maxDepth: 0, maxPages: 1, requestTimeoutMs: 1000, retryLimit: 0,
  extractionConfig: {} as CrawlJobInput['extractionConfig'],
};
const article = `<article>${'Useful server rendered article content. '.repeat(10)}</article>`;

beforeEach(() => {
  vi.mocked(validateUrlForSsrf).mockReset();
  vi.mocked(validateUrlForSsrf).mockResolvedValue({ valid: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pure AUTO detection', () => {
  it.each(['<div id="__next">', '<div id="root">', '<div id="app">'])('keeps SSR content with %s on Cheerio', (root) => {
    expect(requiresBrowserRendering(`<body>${root}${article}</div><script src="/_next/static/a.js"></script></body>`)).toBe(false);
  });
  it('ignores head and script content in an empty SPA shell', () => {
    expect(requiresBrowserRendering(`<head><title>${'Metadata '.repeat(100)}</title></head><body><div id="root"><div></div></div><script>${'payload'.repeat(100)}</script></body>`)).toBe(true);
  });
  it('uses real DOM entity-decoded body text and non-text content', () => {
    expect(requiresBrowserRendering(`<body><div id="app">${'&#65;'.repeat(130)}</div></body>`)).toBe(false);
    expect(requiresBrowserRendering('<body><div id="root"><img src="product.jpg"></div></body>')).toBe(false);
    expect(requiresBrowserRendering('<body><h1>A small static page</h1></body>')).toBe(false);
  });
  it('does not count hidden text or noscript fallback as rendered content', () => {
    expect(requiresBrowserRendering(`<body><div id="app"></div><div hidden>${article}</div><noscript>${article}</noscript></body>`)).toBe(true);
  });
  it.each(['Just a moment', 'Checking your browser', 'Verify you are human', 'Access denied'])('selects browser for challenge %s without claiming it can solve it', (title) => {
    expect(requiresBrowserRendering(`<head><title>${title}</title></head><body>${article}</body>`)).toBe(true);
  });
  it('selects browser for HTTP errors and blank bodies', () => {
    expect(requiresBrowserRendering(article, 403)).toBe(true);
    expect(requiresBrowserRendering('<body></body>')).toBe(true);
  });
});

describe('AUTO startup probe', () => {
  it.each(['CHEERIO', 'PLAYWRIGHT'] as const)('preserves explicit %s without probing', async (strategy) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await new CrawlerFactory().getCrawler({ ...job, strategy })).resolvedStrategy).toBe(strategy);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validateUrlForSsrf).not.toHaveBeenCalled();
  });
  it('never makes an unproxied probe for proxy jobs', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await new CrawlerFactory().getCrawler({ ...job, proxyUrl: 'http://proxy.com:8080' })).resolvedStrategy).toBe('PLAYWRIGHT');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validateUrlForSsrf).toHaveBeenCalledWith(job.targetUrl);
  });
  it('rejects unsafe targets even when a proxy would skip the probe', async () => {
    vi.mocked(validateUrlForSsrf).mockResolvedValue({ valid: false, error: 'private IP' });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(new CrawlerFactory().getCrawler({ ...job, proxyUrl: 'http://proxy.com' })).rejects.toThrow('SSRF');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('manually follows relative redirects only after validating their destination', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/article' } }))
      .mockResolvedValueOnce(new Response(`<body>${article}</body>`, { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await new CrawlerFactory().getCrawler(job)).resolvedStrategy).toBe('CHEERIO');
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    expect(validateUrlForSsrf).toHaveBeenCalledWith('https://public.com/article');
    const validationOrder = vi.mocked(validateUrlForSsrf).mock.invocationCallOrder;
    expect(validationOrder[validationOrder.length - 1]).toBeLessThan(fetchMock.mock.invocationCallOrder[1]);
  });
  it('fails closed when redirect validation stalls rather than selecting a browser', async () => {
    vi.useFakeTimers();
    vi.mocked(validateUrlForSsrf).mockImplementation(async (url) => {
      if (url.endsWith('/redirected')) return new Promise(() => {});
      return { valid: true };
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: '/redirected' } }));
    vi.stubGlobal('fetch', fetchMock);
    const selected = new CrawlerFactory().getCrawler({ ...job, requestTimeoutMs: 25 });
    const rejected = expect(selected).rejects.toThrow('SSRF');
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not send a request or select browser for a forbidden redirect', async () => {
    vi.mocked(validateUrlForSsrf).mockImplementation(async (url) => ({ valid: !url.includes('127.0.0.1'), error: 'private IP' }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CrawlerFactory().getCrawler(job)).rejects.toThrow('SSRF');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([403, 503])('uses browser after probe HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Error', { status })));
    expect((await new CrawlerFactory().getCrawler(job)).resolvedStrategy).toBe('PLAYWRIGHT');
  });
  it('uses browser on transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));
    expect((await new CrawlerFactory().getCrawler(job)).resolvedStrategy).toBe('PLAYWRIGHT');
  });
  it('bounds redirect loops', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await new CrawlerFactory().getCrawler(job)).resolvedStrategy).toBe('PLAYWRIGHT');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it('keeps the timeout active during body reading and clears it afterwards', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) };
    }));
    const selected = new CrawlerFactory().getCrawler({ ...job, requestTimeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect((await selected).resolvedStrategy).toBe('PLAYWRIGHT');
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears successful probe timers and retains static selection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<body>${article}</body>`)));
    expect((await new CrawlerFactory().getCrawler(job)).resolvedStrategy).toBe('CHEERIO');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Playwright hydration wait', () => {
  it('passes timeout as third argument and ignores empty wrappers/body scripts', async () => {
    const { waitForRenderedContent } = await vi.importActual<typeof import('../src/crawlers/playwright.crawler.js')>('../src/crawlers/playwright.crawler.js');
    let text = '';
    const remove = vi.fn();
    const clone = { get textContent() { return text; }, querySelectorAll: () => [{ remove }], querySelector: () => null };
    const root = { children: [{}, {}], cloneNode: () => clone };
    vi.stubGlobal('document', { querySelector: () => null, body: root });
    const waitForFunction = vi.fn().mockImplementation(async (predicate, arg, options) => {
      expect(arg).toBeUndefined();
      expect(options).toEqual({ timeout: 5000 });
      expect(predicate()).toBe(false);
      text = 'Useful content that arrived after client side rendering';
      expect(predicate()).toBe(true);
      expect(remove).toHaveBeenCalled();
    });
    await waitForRenderedContent({ waitForFunction } as unknown as Page);
    expect(waitForFunction).toHaveBeenCalledTimes(1);
  });
});
