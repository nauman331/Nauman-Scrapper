import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page, Route } from 'playwright';
import type { CrawlJobInput } from '../src/crawlers/crawler.interface.js';

const mocks = vi.hoisted(() => ({ validate: vi.fn(), options: undefined as any }));
vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: mocks.validate }));
vi.mock('../src/monitoring/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/core/domain/domain-policy.service.js', () => ({ domainPolicyService: { paceRequest: vi.fn() } }));
vi.mock('../src/persistence/repositories/result.repository.js', () => ({ resultRepository: {
  saveCrawledPage: vi.fn().mockResolvedValue({ id: 'page' }), saveResultIdempotent: vi.fn(),
} }));
vi.mock('../src/persistence/repositories/job.repository.js', () => ({ jobRepository: { incrementCounts: vi.fn() } }));
vi.mock('../src/extraction/pipeline.js', () => ({ runExtractionPipeline: vi.fn().mockReturnValue({
  normalizedData: {}, validation: {}, discoveredUrls: [],
}) }));
vi.mock('../src/crawlers/render-readiness.js', () => ({ waitForRenderedContent: vi.fn(async () => {}) }));
vi.mock('../src/crawlers/rendered-snapshot.js', () => ({ captureRenderedHtml: vi.fn(async (page) => page.content()) }));
vi.mock('crawlee', () => ({
  LogLevel: { WARNING: 1 }, log: { setLevel: vi.fn() }, ProxyConfiguration: class {},
  RequestQueue: { open: vi.fn().mockResolvedValue({ addRequest: vi.fn().mockResolvedValue({wasAlreadyPresent:false,wasAlreadyHandled:false}), drop: vi.fn() }) },
  PlaywrightCrawler: class {
    constructor(options: unknown) { mocks.options = options; }
    async run() {}
  },
}));

import { loadLazyContent, PlaywrightCrawlerRunner, prepareHtmlCapture, routeBrowserRequest } from '../src/crawlers/playwright.crawler.js';

function route(url: string, resourceType = 'stylesheet') {
  return { request: () => ({ url: () => url, resourceType: () => resourceType }), abort: vi.fn(), continue: vi.fn() };
}
function evaluationPage() {
  return { evaluate: vi.fn(async (callback, arg) => callback(arg)) } as unknown as Page;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('capture profile resource routing', () => {
  it('retains fonts only for HTML capture and keeps media/image blocking', async () => {
    mocks.validate.mockResolvedValue({ valid: true });
    for (const extractHtml of [false, true]) {
      const font = route('https://cdn.public.org/font.woff2', 'font');
      await routeBrowserRequest(font as unknown as Route, { extractHtml, extractImages: false });
      expect(font.continue).toHaveBeenCalledTimes(extractHtml ? 1 : 0);
      expect(font.abort).toHaveBeenCalledTimes(extractHtml ? 0 : 1);
    }
    for (const type of ['media', 'image']) {
      const blocked = route('https://cdn.public.org/asset', type);
      await routeBrowserRequest(blocked as unknown as Route, { extractHtml: true, extractImages: false });
      expect(blocked.abort).toHaveBeenCalled();
      expect(blocked.continue).not.toHaveBeenCalled();
    }
  });

  it('validates every HTTP request without private bypass or cached approvals', async () => {
    mocks.validate.mockResolvedValueOnce({ valid: true }).mockResolvedValue({ valid: false });
    for (const url of ['https://cdn.public.org/a.css', 'https://cdn.public.org/b.css', 'http://127.0.0.1/data', 'http://169.254.169.254/latest']) {
      const request = route(url);
      await routeBrowserRequest(request as unknown as Route, { extractHtml: true, extractImages: true });
      expect(mocks.validate).toHaveBeenLastCalledWith(url, false);
      if (url.endsWith('a.css')) expect(request.continue).toHaveBeenCalledOnce();
      else {
        expect(request.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(request.continue).not.toHaveBeenCalled();
      }
    }
  });

  it('fails closed on validation exceptions and malformed URLs but permits inline data', async () => {
    mocks.validate.mockRejectedValue(new Error('DNS unavailable'));
    for (const url of ['https://cdn.public.org/script.js', 'not a URL']) {
      const request = route(url, 'script');
      await routeBrowserRequest(request as unknown as Route, { extractHtml: true, extractImages: true });
      expect(request.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(request.continue).not.toHaveBeenCalled();
    }
    const inline = route('data:image/png;base64,AA', 'image');
    await routeBrowserRequest(inline as unknown as Route, { extractHtml: true, extractImages: true });
    expect(inline.continue).toHaveBeenCalledOnce();
  });
});

describe('HTML snapshot preparation', () => {
  it('awaits fonts, captures inserted CSSOM rules in place, and skips external/inaccessible sheets', async () => {
    vi.useFakeTimers();
    const first = { nodeName: 'STYLE', textContent: '' };
    const last = { nodeName: 'STYLE', textContent: 'original' };
    const link = { nodeName: 'LINK', textContent: null };
    const inaccessible = { nodeName: 'STYLE', textContent: 'keep me' };
    const sheets = [
      { ownerNode: first, cssRules: [{ cssText: '.injected { color: red; }' }] },
      { ownerNode: link, href: 'https://cdn.public.org/main.css', get cssRules() { throw new Error('must not read'); } },
      { ownerNode: inaccessible, get cssRules() { throw new Error('SecurityError'); } },
      { ownerNode: last, cssRules: [{ cssText: '.last { color: blue; }' }] },
    ];
    let ready!: () => void;
    vi.stubGlobal('document', { fonts: { ready: new Promise<void>((resolve) => { ready = resolve; }) }, styleSheets: sheets });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const capture = prepareHtmlCapture(evaluationPage());
    expect(first.textContent).toBe('');
    ready();
    await capture;
    expect(first.textContent).toBe('.injected { color: red; }');
    expect(last.textContent).toBe('.last { color: blue; }');
    expect(inaccessible.textContent).toBe('keep me');
    expect(link.textContent).toBeNull();
    expect(sheets.map((sheet) => sheet.ownerNode)).toEqual([first, link, inaccessible, last]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stalled font readiness at two seconds and tolerates font failures', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', { fonts: { ready: new Promise(() => {}) }, styleSheets: [] });
    const capture = prepareHtmlCapture(evaluationPage());
    await vi.advanceTimersByTimeAsync(2000);
    await capture;
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal('document', { fonts: { ready: Promise.reject(new Error('font failed')) }, styleSheets: [] });
    await prepareHtmlCapture(evaluationPage());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs font/CSSOM preparation before content only in the HTML profile', async () => {
    mocks.validate.mockResolvedValue({ valid: true });
    for (const extractHtml of [false, true]) {
      const job = { jobId: 'job', targetUrl: 'https://public.org', domain: 'public.org', maxPages: 1,
        maxDepth: 0, requestTimeoutMs: 15000, retryLimit: 0, extractionConfig: { extractHtml, extractImages: false },
      } as CrawlJobInput;
      await new PlaywrightCrawlerRunner().run(job);
      const events: string[] = [];
      const page = {
        url: () => job.targetUrl, viewportSize: () => ({width:1280,height:800}), waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined), waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (_callback, arg) => { events.push(typeof arg === 'number' ? 'fonts' : arg ? 'scroll' : 'cssom'); }),
        content: vi.fn(async () => { events.push('content'); return '<html></html>'; }),
        addInitScript: vi.fn(), route: vi.fn(),
      };
      await mocks.options.preNavigationHooks[0]({ page, request: { url: job.targetUrl } });
      expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
      await mocks.options.requestHandler({ page, request: { url: job.targetUrl, userData: { depth: 0 } } });
      expect(events).toEqual(extractHtml ? ['fonts', 'cssom', 'content'] : ['scroll', 'content']);
    }
  });
});

describe('bounded incremental lazy scrolling', () => {
  function scrollingPage(height: number) {
    const state = { scrollX: 15, scrollY: 100, innerHeight: 1000,
      scrollTo: vi.fn(({ left, top }) => { state.scrollX = left; state.scrollY = top; }),
      setTimeout: vi.fn((callback, _delay) => { callback(); return 1; }),
    };
    vi.stubGlobal('window', state);
    vi.stubGlobal('document', { documentElement: { scrollHeight: height } });
    return state;
  }
  it('traverses intermediate viewports on static pages within the original twelve-step budget', async () => {
    const state = scrollingPage(20000);
    await loadLazyContent(evaluationPage());
    const positions = state.scrollTo.mock.calls.map(([position]) => position.top);
    expect(positions.slice(0, 3)).toEqual([900, 1700, 2500]);
    expect(state.setTimeout).toHaveBeenCalledTimes(12);
    expect(state.setTimeout.mock.calls.every(([, delay]) => delay === 650)).toBe(true);
    expect(positions.at(-1)).toBe(100);
    expect(state.scrollX).toBe(15);
  });
  it('stops after three stable bottom rounds and restores scroll even on failure', async () => {
    const state = scrollingPage(1500);
    await loadLazyContent(evaluationPage());
    expect(state.setTimeout).toHaveBeenCalledTimes(3);
    expect(state.scrollY).toBe(100);
    state.setTimeout.mockImplementation(() => { throw new Error('page interrupted'); });
    await expect(loadLazyContent(evaluationPage())).rejects.toThrow('page interrupted');
    expect(state.scrollY).toBe(100);
    expect(state.scrollX).toBe(15);
  });
});
