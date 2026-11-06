import { describe, expect, it, vi } from 'vitest';
import { Script, createContext, runInContext } from 'node:vm';
import { load } from 'cheerio';
import { renderPlaygroundHtml } from '../src/api/views/playground.html.js';
import { renderHtmlGeneratorScript } from '../src/api/views/html-generator.html.js';

const html = renderPlaygroundHtml();
class PreviewDOMParser {
  parseFromString(content: string) {
    const $ = load(content);
    return {
      querySelectorAll: (selector: string) =>
        $(selector)
          .toArray()
          .map((element) => ({ remove: () => $(element).remove() })),
      createElement: (tag: string) => ({ tag, href: '', httpEquiv: '', content: '' }),
      head: {
        prepend: (element: any) =>
          $('head').prepend(
            element.tag === 'base'
              ? `<base href="${element.href}">`
              : `<meta http-equiv="${element.httpEquiv}" content="${element.content}">`
          ),
      },
      documentElement: {
        get outerHTML() {
          return $.html();
        },
      },
    };
  }
}
const progressElements = (): Record<string, any> =>
  Object.fromEntries(
    [
      'htmlScrapeProgressCard',
      'htmlScrapeProgressTrack',
      'htmlScrapeProgressBar',
      'htmlScrapeProgressPercent',
      'htmlScrapeProgressStatus',
      'htmlScrapeStagesList',
      'btnHtmlScrape',
    ].map((id) => [id, { style: {}, setAttribute: vi.fn(), removeAttribute: vi.fn() }])
  );

describe('HTML generator dashboard integration', () => {
  it('adds navigation immediately after Next.js without changing its workspace', () => {
    const $ = load(html);
    expect($('#nextjsNav').next().attr('id')).toBe('htmlNav');
    expect($('#htmlNav').text().trim()).toBe('HTML generator');
    expect($('#htmlView').hasClass('nextjs-workspace')).toBe(true);
    expect($('#nextjsView').hasClass('nextjs-workspace')).toBe(true);
    expect($('#nextjsProjectName')).toHaveLength(1);
    expect($('#htmlTargetUrl')).toHaveLength(1);
    expect(
      $('#htmlCloneMode option')
        .map((_, el) => $(el).attr('value'))
        .get()
    ).toEqual(['single', 'full']);
    expect($('#htmlMaxPages').attr('max')).toBe('500');
  });

  it('renders options, progress, warnings, source-code explorer and ZIP export', () => {
    const $ = load(html);
    for (const id of [
      'htmlJobSelect',
      'htmlProjectName',
      'htmlPreserveMetadata',
      'htmlPreserveInteractivity',
      'htmlPagesTable',
      'htmlProgressCard',
      'htmlStagesList',
      'htmlResultCard',
      'htmlValidationDetails',
      'htmlFileTree',
      'htmlFileContent',
      'btnHtmlDownloadZip',
    ]) {
      expect($('#' + id)).toHaveLength(1);
    }
    const ids = $('[id]')
      .map((_, el) => $(el).attr('id'))
      .get();
    expect(new Set(ids).size).toBe(ids.length);
    expect($('#htmlResultCard').text()).toContain('No npm install');
    expect($('#htmlView').text()).toContain('not recreated');
    expect($('#htmlCssStrategy option').map((_, element) => $(element).attr('value')).get()).toEqual(['tailwind', 'core']);
    expect($('#htmlCssStrategy option[value="core"]').text()).toBe('HTML + Core CSS');
    expect($('#htmlCssStrategy').closest('#htmlOptionsContainer')).toHaveLength(0);
    expect($('#htmlCssStrategy').attr('aria-describedby')).toBe('htmlCssStrategyHint');
  });

  it.each(['tailwind', 'core'])('submits the selected %s strategy independently', async cssStrategy => {
    const elements: Record<string, any> = {
      htmlProjectName: { value: 'test-project', reportValidity: () => true },
      htmlCssStrategy: { value: cssStrategy }, htmlPreserveMetadata: { checked: true },
      htmlPreserveInteractivity: { checked: true }, htmlMaxPages: {}, htmlCloneMode: { value: 'single' },
      htmlResultCard: { style: {} }, htmlProgressCard: { style: {} }, htmlStagesList: {},
      htmlProgressBar: { style: {} }, htmlProgressPercent: {}, htmlConversionActivity: {},
      htmlConversionActivityStatus: {}, htmlConversionProgressTrack: { setAttribute: vi.fn() }, htmlMessage: {},
    };
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Submission captured' } }) });
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: (selector: string) => selector === '.html-page-chk:checked' ? [{ value: 'https://site.test/' }] : [] }, fetch, proxyHeaders: {}, clearInterval: vi.fn() });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext("htmlGenerator.jobId = 'job'; resetHtmlWebsitePreview = () => {};", context);
    await runInContext('executeHtmlConversion()', context);
    expect(JSON.parse(fetch.mock.calls[0][1].body).options.cssStrategy).toBe(cssStrategy);
    expect(runInContext('htmlGenerator.busy', context)).toBe(false);
  });

  it('places accessible, opt-in proxy routing above the URL entries and supports adding proxies', () => {
    const $ = load(html);
    expect($('#htmlProxyControls').next().attr('id')).toBe('htmlUrlRows');
    expect($('#htmlEnableProxy').attr('type')).toBe('checkbox');
    expect($('#htmlEnableProxy').attr('checked')).toBeUndefined();
    expect($('#htmlProxySelect').attr('disabled')).toBeDefined();
    expect($('label[for="htmlProxySelect"]')).toHaveLength(1);
    expect($('#btnHtmlRefreshProxies').attr('type')).toBe('button');
    expect($('#htmlProxyControls a').attr('href')).toBe('/proxies');
    expect($('#htmlProxyHint').attr('aria-live')).toBe('polite');
    expect($('#proxyForm').attr('onsubmit')).toBe('addProxy(event)');
    expect($('#proxyUrl').attr('required')).toBeDefined();
    expect($('#btnAddProxy').attr('type')).toBe('submit');
  });

  it.each([false, true])('submits opt-in proxy routing for scrape and conversion (enabled: %s)', async enabled => {
    const elements: Record<string, any> = {
      ...progressElements(), htmlEnableProxy: { checked: enabled }, htmlProxySelect: { value: 'proxy-a' }, htmlProxyHint: {},
      htmlTargetUrl: { value: 'https://site.test/' }, htmlCloneMode: { value: 'single' }, htmlMaxPages: {}, htmlStrategy: { value: 'PLAYWRIGHT' },
      htmlProjectName: { value: 'test-project', reportValidity: () => true }, htmlCssStrategy: { value: 'core' },
      htmlPreserveMetadata: { checked: true }, htmlPreserveInteractivity: { checked: true },
      htmlResultCard: { style: {} }, htmlProgressCard: { style: {} }, htmlStagesList: {}, htmlProgressBar: { style: {} }, htmlProgressPercent: {},
      htmlConversionActivity: {}, htmlConversionActivityStatus: {}, htmlConversionProgressTrack: { setAttribute: vi.fn() }, htmlMessage: {},
    };
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Captured' } }) });
    const controls = [elements.htmlEnableProxy, elements.htmlProxySelect];
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: (selector: string) => selector === '.html-page-chk:checked' ? [{ value: 'https://site.test/' }] : controls }, fetch, proxyHeaders: {}, URL, escapeHtml: (value: string) => value, clearInterval: vi.fn(), event: { preventDefault: vi.fn() } });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext('resetHtmlWebsitePreview = () => {};', context);
    await runInContext('scrapeHtmlPage(event)', context);
    const scrape = JSON.parse(fetch.mock.calls[0][1].body);
    expect(scrape.proxyId).toBe(enabled ? 'proxy-a' : undefined);
    expect(scrape).not.toHaveProperty('useProxy');
    runInContext("htmlGenerator.jobId = 'job';", context);
    await runInContext('executeHtmlConversion()', context);
    const conversion = JSON.parse(fetch.mock.calls[1][1].body).options;
    expect(conversion.useProxy).toBe(enabled);
    expect(conversion.proxyId).toBe(enabled ? 'proxy-a' : undefined);
    expect(elements.htmlProxySelect.value).toBe('proxy-a');
    expect(elements.htmlProxySelect.disabled).toBe(!enabled);
    expect(elements.htmlEnableProxy.disabled).toBe(false);
  });

  it('blocks enabled routing with no selection for both scrape and conversion', async () => {
    const elements: Record<string, any> = { htmlEnableProxy: { checked: true }, htmlProxySelect: { value: '', focus: vi.fn() }, htmlMessage: {}, htmlProjectName: { reportValidity: () => true } };
    const fetch = vi.fn();
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [{ value: 'https://site.test/' }] }, fetch, event: { preventDefault: vi.fn() } });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext("htmlGenerator.jobId = 'job'; getHtmlPageUrls = () => ['https://site.test/'];", context);
    await runInContext('executeHtmlScrape(event)', context);
    await runInContext('executeHtmlConversion()', context);
    expect(fetch).not.toHaveBeenCalled();
    expect(elements.htmlMessage.textContent).toContain('Select a saved proxy');
    expect(elements.htmlProxySelect.focus).toHaveBeenCalledTimes(2);
    expect(runInContext('htmlGenerator.busy', context)).toBe(false);
  });

  it('synchronizes both proxy selectors while preserving selection and active HTML routing', async () => {
    const $ = load(html);
    const source = $('script').map((_, element) => $(element).html()).get().join('\n');
    const controller = source.slice(source.indexOf('    async function loadProxies()'), source.indexOf('    async function addProxy('));
    const makeSelect = (value: string) => {
      let selected = value;
      return { get value() { return selected; }, set value(next: string) { selected = next; }, set innerHTML(_next: string) { selected = ''; } };
    };
    const elements: Record<string, any> = { proxySelect: makeSelect('proxy-a'), htmlProxySelect: makeSelect('proxy-b'), proxyTotalCount: {}, proxyCountBadge: {}, proxyList: {}, proxyMessage: {}, htmlProxyHint: {} };
    let items = [{ id: 'proxy-a', name: 'A', displayUrl: 'masked-a' }, { id: 'proxy-b', name: 'B', displayUrl: 'masked-b' }];
    const toggle = vi.fn();
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [] }, proxyRequest: async () => items, htmlGenerator: { busy: false }, handleHtmlProxyToggle: toggle, escapeHtml: (value: string) => value });
    runInContext(controller, context);
    await runInContext('loadProxies()', context);
    expect(elements.proxySelect.value).toBe('proxy-a');
    expect(elements.htmlProxySelect.value).toBe('proxy-b');
    items = [items[0]];
    runInContext('htmlGenerator.busy = true;', context);
    await runInContext('loadProxies()', context);
    expect(elements.htmlProxySelect.value).toBe('proxy-b');
    runInContext('htmlGenerator.busy = false;', context);
    await runInContext('loadProxies()', context);
    expect(elements.htmlProxySelect.value).toBe('');
    expect(toggle).toHaveBeenCalledTimes(3);
  });

  it('adds accessible preview and project-file tabs with a sandboxed website frame', () => {
    const $ = load(html);
    expect($('#htmlResultCard [role="tab"]').map((_, element) => $(element).text()).get()).toEqual(['Code Preview', 'Live Preview']);
    expect($('#htmlCodePanel #htmlFileTree')).toHaveLength(1);
    expect($('#htmlCodePanel #htmlFileContent')).toHaveLength(1);
    expect($('#htmlPreviewPanel #htmlPreviewFrame')).toHaveLength(1);
    expect($('#htmlPreviewTab').attr('role')).toBe('tab');
    expect($('#htmlPreviewTab').attr('aria-controls')).toBe('htmlPreviewPanel');
    expect($('#htmlCodePanel').attr('hidden')).toBeDefined();
    expect($('#htmlPreviewFrame').attr('sandbox')).toBe('');
    expect($('#htmlPreviewFrame').attr('referrerpolicy')).toBe('no-referrer');
    expect($('#htmlPreviewPage')).toHaveLength(1);
    expect($('#htmlPreviewReload')).toHaveLength(0);
    expect($('#htmlResultCard [role="tablist"]').attr('style')).toContain('justify-content:flex-start');
  });

  it('loads a generated page using a scoped session and preserves relative asset URLs', async () => {
    const elements: Record<string, any> = {
      htmlPreviewPage: { value: 'pages/about.html' },
      htmlPreviewFrame: { removeAttribute: vi.fn() },
      htmlPreviewStatus: {},
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { baseUrl: '/api/v1/html-preview/session/' } }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { content: '<html><head></head><body>Preview</body></html>' } }),
      });
    const context = createContext({
      document: { getElementById: (id: string) => elements[id], baseURI: 'http://localhost:3000/' },
      fetch,
      proxyHeaders: { 'x-api-key': 'secret', 'Content-Type': 'application/json' },
      DOMParser: PreviewDOMParser,
      URL,
    });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext("htmlGenerator.conversionId = 'html_test'", context);
    await runInContext('loadHtmlWebsitePreview()', context);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/html-conversions/html_test/preview');
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('secret');
    expect(fetch.mock.calls[0][1].body).toBe('{}');
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/html-conversions/html_test/files?path=pages%2Fabout.html');
    expect(elements.htmlPreviewFrame.srcdoc).toContain(
      '<base href="http://localhost:3000/api/v1/html-preview/session/pages/about.html">'
    );
    expect(elements.htmlPreviewFrame.srcdoc).toContain('Preview');
    expect(elements.htmlPreviewFrame.hidden).toBe(false);
    elements.htmlPreviewFrame.onload();
    expect(elements.htmlPreviewStatus.textContent).toContain('Showing pages/about.html');
    elements.htmlPreviewPage.value = 'index.html';
    await runInContext('loadHtmlWebsitePreview()', context);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(elements.htmlPreviewFrame.srcdoc).toContain(
      '<base href="http://localhost:3000/api/v1/html-preview/session/index.html">'
    );
    runInContext('resetHtmlWebsitePreview()', context);
    expect(elements.htmlPreviewFrame.hidden).toBe(true);
    expect(runInContext('htmlGenerator.previewBaseUrl', context)).toBe('');
  });

  it('reports preview failures without displaying an error document', async () => {
    const elements: Record<string, any> = {
      htmlPreviewPage: { value: 'index.html' },
      htmlPreviewFrame: {},
      htmlPreviewStatus: {},
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Not ready' } }) });
    const context = createContext({
      document: { getElementById: (id: string) => elements[id] },
      fetch,
      proxyHeaders: {},
    });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext("htmlGenerator.conversionId = 'html_test'", context);
    await runInContext('loadHtmlWebsitePreview()', context);
    expect(elements.htmlPreviewStatus.textContent).toBe('Preview unavailable: Not ready');
    expect(elements.htmlPreviewFrame.hidden).toBe(true);
  });

  it('produces syntactically valid browser JavaScript including injected controller', () => {
    const $ = load(html);
    $('script').each((_, el) => {
      expect(() => new Script($(el).html() || '')).not.toThrow();
    });
  });

  it('shows URL rows and Plus while leaving legacy controls hidden', () => {
    const $ = load(html);
    expect($('#htmlUrlRows .html-page-url')).toHaveLength(1);
    expect($('#btnHtmlAddPage').text()).toContain('+ Add page');
    expect($('#htmlCloneMode').closest('[hidden]')).toHaveLength(1);
    expect($('#btnHtmlScrape').text()).toBe('Scrape the website');
  });

  it('orchestrates existing single-page scrapes without modifying their capture settings', async () => {
    const elements: Record<string, any> = { ...progressElements(), htmlTargetUrl: {}, htmlCloneMode: {}, htmlMaxPages: {}, htmlJobLabel: {}, htmlMessage: {}, htmlEnableProxy: { checked: true }, htmlProxySelect: { value: 'proxy-a' }, htmlProxyHint: {} };
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [elements.htmlEnableProxy, elements.htmlProxySelect] }, escapeHtml: (value: string) => value, event: { preventDefault: vi.fn() } });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext(`getHtmlPageUrls = () => ['https://site.test/', 'https://site.test/about'];
      const submitted = [];
      scrapeHtmlPage = async (_event, routing) => {
        if (!htmlGenerator.busy || !document.getElementById('htmlEnableProxy').disabled || !document.getElementById('htmlProxySelect').disabled) throw new Error('Batch routing controls must stay frozen');
        if (!routing.useProxy || routing.proxyId !== 'proxy-a') throw new Error('Batch route changed');
        submitted.push(document.getElementById('htmlTargetUrl').value);
        if (document.getElementById('htmlCloneMode').value !== 'single') throw new Error('Not a normal single-page job');
        htmlGenerator.jobId = 'job' + submitted.length;
        htmlGenerator.inventory = {pages:[{url:submitted[submitted.length-1]}]}; return true;
      }; renderHtmlPages = () => {};`, context);
    await runInContext('executeHtmlScrape(event)', context);
    expect(Array.from(runInContext('submitted', context))).toEqual(['https://site.test/', 'https://site.test/about']);
    expect(Array.from(runInContext('htmlGenerator.snapshotJobIds', context))).toEqual(['job1', 'job2']);
    expect(runInContext('htmlGenerator.inventory.totalPages', context)).toBe(2);
    expect(runInContext('htmlGenerator.jobId', context)).toBe('job1');
  });

  it('normalizes a bare URL and submits a single-page HTML-capture job', async () => {
    const elements: Record<string, any> = {
      ...progressElements(),
      htmlTargetUrl: { value: 'example.com' },
      htmlCloneMode: { value: 'single' },
      htmlMaxPages: { value: '50', reportValidity: () => true },
      htmlStrategy: { value: 'CHEERIO' },
      htmlMessage: {},
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'Test submission stopped' } }),
      });
    const context = createContext({
      document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [] },
      fetch,
      proxyHeaders: {},
      escapeHtml: (value: string) => value,
      URL,
    });
    runInContext(renderHtmlGeneratorScript(), context);
    const preventDefault = vi.fn();
    context.event = { preventDefault };
    await runInContext('scrapeHtmlPage(event)', context);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/jobs');
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      targetUrl: 'https://example.com',
      strategy: 'CHEERIO',
      maxPages: 1,
      maxDepth: 0,
    });
    expect(payload.extractionConfig).toMatchObject({
      extractHtml: true,
      discoverLinks: false,
      filterInternalLinksOnly: true,
    });
    expect(elements.htmlTargetUrl.value).toBe('https://example.com');
    expect(elements.htmlMessage.textContent).toBe('Test submission stopped');
    expect(runInContext('htmlGenerator.busy', context)).toBe(false);
  });

  it('submits a bounded full-website crawl with link discovery', async () => {
    const elements: Record<string, any> = {
      ...progressElements(),
      htmlTargetUrl: { value: 'https://example.com' },
      htmlCloneMode: { value: 'full' },
      htmlMaxPages: { value: '500', reportValidity: () => true },
      htmlStrategy: { value: 'PLAYWRIGHT' },
      htmlMessage: {},
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Test stopped' } }) });
    const context = createContext({
      document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [] },
      fetch,
      proxyHeaders: {},
      escapeHtml: (value: string) => value,
      URL,
      event: { preventDefault: vi.fn() },
    });
    runInContext(renderHtmlGeneratorScript(), context);
    await runInContext('scrapeHtmlPage(event)', context);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload).toMatchObject({ strategy: 'PLAYWRIGHT', maxPages: 500, maxDepth: 10 });
    expect(payload.extractionConfig).toMatchObject({
      extractHtml: true,
      discoverLinks: true,
      filterInternalLinksOnly: true,
    });
    expect(elements.htmlMaxPages.disabled).toBe(false);
  });

  it('completes scrape progress only after the captured snapshot loads', async () => {
    const elements: Record<string, any> = {
      ...progressElements(),
      htmlTargetUrl: { value: 'example.com' },
      htmlCloneMode: { value: 'single' },
      htmlMaxPages: { value: '1' },
      htmlStrategy: { value: 'CHEERIO' },
      htmlMessage: {},
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'job', status: 'COMPLETED', totalPagesCrawled: 1 } }),
      });
    const context = createContext({
      document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [] },
      fetch,
      proxyHeaders: {},
      escapeHtml: (value: string) => value,
      URL,
      event: { preventDefault: vi.fn() },
    });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext(
      "populateHtmlJobsList = async () => {}; loadHtmlSnapshot = async (id, internal) => { if (!internal || !htmlGenerator.busy) throw new Error('Snapshot must load internally while busy'); return true; };",
      context
    );
    await runInContext('scrapeHtmlPage(event)', context);
    expect(elements.htmlScrapeProgressPercent.textContent).toBe('100%');
    expect(elements.htmlScrapeStagesList.innerHTML.match(/stage-completed/g)).toHaveLength(3);
    expect(elements.htmlMessage.textContent).toContain('Scrape completed');
    expect(elements.btnHtmlScrape.textContent).toBe('Scrape URL & Load Pages');
    expect(runInContext('htmlGenerator.busy', context)).toBe(false);
  });

  it('shows aggregate progress for six input URLs instead of each single-page job limit', () => {
    const elements = progressElements();
    const context = createContext({ document: { getElementById: (id: string) => elements[id] }, escapeHtml: (value: string) => value });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext("htmlGenerator.scrapeBatch = { total: 6, completed: 0 }; renderHtmlScrapeProgress('crawling', {totalPagesCrawled:0}, 1)", context);
    expect(elements.btnHtmlScrape.textContent).toBe('Scraping 0 / 6');
    runInContext("htmlGenerator.scrapeBatch.completed = 3; renderHtmlScrapeProgress('crawling', {totalPagesCrawled:0}, 1)", context);
    expect(elements.btnHtmlScrape.textContent).toBe('Scraping 3 / 6');
    runInContext("renderHtmlScrapeProgress('completed', {totalPagesCrawled:1}, 1)", context);
    expect(elements.btnHtmlScrape.textContent).toBe('Scraping 4 / 6');
    expect(elements.htmlScrapeProgressPercent.textContent).not.toBe('100%');
    runInContext("htmlGenerator.scrapeBatch.completed = 5; renderHtmlScrapeProgress('completed', {totalPagesCrawled:1}, 1)", context);
    expect(elements.htmlScrapeProgressStatus.textContent).toContain('6 / 6');
    expect(elements.htmlScrapeProgressPercent.textContent).toBe('100%');
  });

  it('shows immediate, queued, crawling, loading, completed and error progress without fake totals', () => {
    const elements = progressElements();
    const context = createContext({
      document: { getElementById: (id: string) => elements[id] },
      escapeHtml: (value: string) => value,
    });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext("renderHtmlScrapeProgress('starting', {}, 50)", context);
    expect(elements.htmlScrapeProgressCard.style.display).toBe('block');
    expect(elements.htmlScrapeProgressBar.className).toBe('scrape-indeterminate progress-active');
    expect(elements.htmlScrapeProgressTrack.removeAttribute).toHaveBeenCalledWith('aria-valuenow');
    runInContext("renderHtmlScrapeProgress('queued', {id:'job'}, 50)", context);
    expect(elements.htmlScrapeProgressPercent.textContent).toBe('Queued');
    runInContext("renderHtmlScrapeProgress('crawling', {id:'job',totalPagesCrawled:10}, 50)", context);
    expect(elements.htmlScrapeProgressBar.style.width).toBe('18%');
    expect(elements.htmlScrapeProgressBar.className).toBe('progress-active');
    expect(elements.htmlScrapeProgressStatus.textContent).toContain('10 / 50 page limit');
    expect(elements.btnHtmlScrape.textContent).toBe('Scraping 10 / 50');
    runInContext("renderHtmlScrapeProgress('loading', {totalPagesCrawled:10}, 50)", context);
    expect(elements.htmlScrapeProgressPercent.textContent).toBe('Loading pages');
    runInContext("renderHtmlScrapeProgress('completed', {totalPagesCrawled:10}, 50)", context);
    expect(elements.htmlScrapeProgressBar.style.width).toBe('100%');
    expect(elements.htmlScrapeProgressBar.className).toBe('');
    expect(elements.htmlScrapeStagesList.innerHTML.match(/stage-completed/g)).toHaveLength(3);
    runInContext(
      "renderHtmlScrapeProgress('starting'); renderHtmlScrapeProgress('failed', {}, 1, 'Browser unavailable')",
      context
    );
    expect(elements.htmlScrapeProgressPercent.textContent).toBe('Failed');
    expect(elements.htmlScrapeProgressStatus.textContent).toContain('Browser unavailable');
    expect(elements.htmlScrapeStagesList.innerHTML).toContain('stage-failed');
    runInContext("renderHtmlScrapeProgress('partial', {totalPagesCrawled:2}, 50)", context);
    expect(elements.htmlScrapeProgressPercent.textContent).toBe('Partial completion');
    runInContext("renderHtmlScrapeProgress('completed', {totalPagesCrawled:52}, 50)", context);
    expect(elements.htmlScrapeProgressStatus.textContent).not.toContain('52 / 50');
    expect(elements.htmlScrapeProgressStatus.textContent).toContain('exceeded by 2');
  });

  it('animates conversion activity without changing real progress and respects reduced motion', () => {
    const elements: Record<string, any> = {
      htmlProgressBar: { style: {} },
      htmlProgressPercent: {},
      htmlStagesList: {},
      htmlConversionActivity: {},
      htmlConversionActivityStatus: {},
      htmlConversionProgressTrack: { setAttribute: vi.fn() },
    };
    let tick: () => void = () => {};
    const setInterval = vi.fn((callback: () => void) => {
      tick = callback;
      return 1;
    });
    const clearInterval = vi.fn();
    const context = createContext({
      document: { getElementById: (id: string) => elements[id] },
      escapeHtml: (value: string) => value,
      setInterval,
      clearInterval,
    });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext('resetHtmlConversionProgress()', context);
    runInContext(
      "renderHtmlStages([{status:'completed',label:'Load'}, {status:'running',label:'Generate'}])",
      context
    );
    expect(elements.htmlProgressBar.className).toBe('progress-active');
    tick();
    expect(elements.htmlProgressPercent.textContent).toBe('1%');
    for (let index = 1; index < 50; index++) tick();
    expect(elements.htmlProgressBar.style.width).toBe('50%');
    expect(elements.htmlConversionActivity.hidden).toBe(false);
    expect(elements.htmlConversionActivityStatus.textContent).toContain('In progress: Generate');
    expect(elements.htmlConversionProgressTrack.setAttribute).toHaveBeenCalledWith('aria-valuenow', '50');
    runInContext(
      "renderHtmlStages([{status:'completed',label:'Load'}, {status:'completed',label:'Generate'}])",
      context
    );
    expect(elements.htmlProgressBar.className).toBe('');
    tick();
    expect(elements.htmlProgressPercent.textContent).toBe('51%');
    for (let index = 1; index < 50; index++) tick();
    expect(elements.htmlProgressBar.style.width).toBe('100%');
    expect(elements.htmlConversionActivity.hidden).toBe(true);
    runInContext(
      "renderHtmlStages([{status:'completed',label:'Load'}, {status:'failed',label:'Generate',message:'Download failed'}])",
      context
    );
    expect(elements.htmlConversionActivity.hidden).toBe(true);
    expect(elements.htmlConversionActivityStatus.textContent).toContain('Download failed');
    expect(html).toContain('prefers-reduced-motion:reduce');
    expect(html).toContain('html-progress-shimmer');
  });

  it('selects all saved pages with checkboxes and deselects all independently of crawl scope', () => {
    const checks = [{ checked: false }, { checked: false }, { checked: false }];
    const context = createContext({ document: { querySelectorAll: () => checks } });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext('toggleHtmlPages(true)', context);
    expect(checks.every((check) => check.checked)).toBe(true);
    runInContext('toggleHtmlPages(false)', context);
    expect(checks.every((check) => !check.checked)).toBe(true);
    expect(renderHtmlGeneratorScript()).toContain("cloneMode: pages.length > 1 ? 'full' : 'single'");
  });

  it('uses isolated page selection and correct HTML API contracts', async () => {
    const elements: Record<string, any> = {
      htmlCloneMode: { value: 'single' },
      htmlMaxPages: {},
      htmlPagesList: {},
      htmlActiveFilePath: {},
      htmlFileContent: {},
      htmlMessage: {},
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { content: '<!DOCTYPE html>' } }) });
    const context = createContext({
      document: { getElementById: (id: string) => elements[id] },
      fetch,
      proxyHeaders: {},
      escapeHtml: (value: string) => value,
      URL,
    });
    runInContext(renderHtmlGeneratorScript(), context);
    runInContext(
      "htmlGenerator.inventory = { targetUrl: 'https://example.com/blog', pages: [{url: 'https://example.com/', route: '/', title: 'Home'}, {url: 'https://example.com/blog', route: '/blog', title: 'Blog'}] }; renderHtmlPages(); handleHtmlScopeChange();",
      context
    );
    expect(elements.htmlMaxPages.disabled).toBe(true);
    expect(elements.htmlPagesList.innerHTML.match(/ checked/g)).toHaveLength(2);
    expect(elements.htmlPagesList.innerHTML).toContain('type="checkbox"');
    expect(elements.htmlPagesList.innerHTML).not.toContain('type="radio"');
    elements.htmlCloneMode.value = 'full';
    runInContext('handleHtmlScopeChange();', context);
    expect(elements.htmlMaxPages.disabled).toBe(false);
    expect(elements.htmlPagesList.innerHTML.match(/ checked/g)).toHaveLength(2);
    expect(elements.htmlPagesList.innerHTML).toContain('type="checkbox"');
    runInContext("htmlGenerator.conversionId = 'html_test';", context);
    await runInContext("selectHtmlFile('blog/detail.html')", context);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/html-conversions/html_test/files?path=blog%2Fdetail.html');
    expect(elements.htmlFileContent.textContent).toBe('<!DOCTYPE html>');
    expect(renderHtmlGeneratorScript()).toContain("'/convert/html'");
    expect(renderHtmlGeneratorScript()).not.toContain("'/api/v1/conversions'");
  });
});
