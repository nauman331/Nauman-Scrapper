import { describe, expect, it, vi } from 'vitest';
import { Script, createContext, runInContext } from 'node:vm';
import { load } from 'cheerio';
import { renderPlaygroundHtml } from '../src/api/views/playground.html.js';
import { renderExactCloneHtml, renderExactCloneScript } from '../src/api/views/exact-clone.html.js';
import { renderHtmlGeneratorScript } from '../src/api/views/html-generator.html.js';

const html = renderPlaygroundHtml();
const scripts = renderHtmlGeneratorScript() + renderExactCloneScript();

describe('Exact clone dashboard', () => {
  it('integrates independent navigation, forms and previews without styling or crawler choices', () => {
    const $ = load(html);
    expect($('#htmlNav').next().attr('id')).toBe('exactNav');
    expect($('#exactNav').text().trim()).toBe('Exact clone');
    expect($('#exactNav').attr('onclick')).toContain("showView('exact')");
    for (const prefix of ['html', 'exact']) {
      for (const suffix of ['View', 'UrlForm', 'TargetUrl', 'JobSelect', 'OptionsContainer', 'ProjectName', 'PagesList', 'ProgressCard', 'ResultCard', 'PreviewFrame', 'FileTree']) {
        expect($('#' + prefix + suffix)).toHaveLength(1);
      }
      expect($('#' + prefix + 'Strategy')).toHaveLength(prefix === 'exact' ? 0 : 1);
      if (prefix === 'exact') expect($('#exactView').text()).not.toContain('Crawler Engine');
      else expect($('#htmlStrategy option').map((_, el) => $(el).val()).get()).toEqual(['PLAYWRIGHT', 'AUTO', 'CHEERIO']);
      expect($('#' + prefix + 'PreserveInteractivity').attr('checked')).toBeDefined();
      expect($('#' + prefix + 'PreviewFrame').attr('sandbox')).toBe('');
    }
    expect($('#htmlCssStrategy option').val()).toBe('tailwind');
    expect($('#exactView select').text()).not.toMatch(/tailwind/i);
    expect($('#exactCssStrategy')).toHaveLength(0);
    expect($('#exactView').text()).not.toMatch(/tailwind/i);
    expect($('#exactView').text()).toContain('original CSS');
    expect($('#exactView').text()).toContain('scripts and backend behavior are not restored');
    expect($('#exactPreviewTab').attr('aria-controls')).toBe('exactPreviewPanel');
    expect($('#exactUrlRows .exact-page-url')).toHaveLength(1);
    const ids = $('[id]').map((_, el) => $(el).attr('id')).get();
    expect(new Set(ids).size).toBe(ids.length);
    expect(renderExactCloneHtml()).not.toContain('htmlView');
  });

  it('parses both controllers together and keeps generator state and selection separate', () => {
    const $ = load(html);
    $('script').each((_, element) => expect(() => new Script($(element).html() || '')).not.toThrow());
    const htmlChecks = [{ checked: true }];
    const exactChecks = [{ checked: true }];
    const context = createContext({ document: { querySelectorAll: (selector: string) => selector === '.exact-page-chk' ? exactChecks : htmlChecks } });
    runInContext(scripts, context);
    runInContext("htmlGenerator.jobId = 'html-job'; htmlGenerator.conversionId = 'html-result'; exactGenerator.jobId = 'exact-job'; exactGenerator.conversionId = 'exact-result'; toggleExactPages(false);", context);
    expect(runInContext('htmlGenerator.jobId', context)).toBe('html-job');
    expect(runInContext('htmlGenerator.conversionId', context)).toBe('html-result');
    expect(runInContext('exactGenerator.jobId', context)).toBe('exact-job');
    expect(runInContext('exactGenerator === htmlGenerator', context)).toBe(false);
    expect(htmlChecks[0].checked).toBe(true);
    expect(exactChecks[0].checked).toBe(false);
    expect(renderExactCloneScript()).not.toMatch(/htmlGenerator|cssStrategy|Tailwind|htmlRequest/);
    expect(renderExactCloneScript()).toContain("const exactConversionApi = '/api/v1/exact-conversions'");
    expect(renderExactCloneScript()).toContain("escapeHtml(page.title)");
    expect(renderExactCloneScript()).toContain("endsWith('.html')");
  });

  it.each(['html', 'exact'])('submits %s conversion options to the correct endpoint with shared status service', async (prefix) => {
    const title = prefix === 'html' ? 'Html' : 'Exact';
    const elements: Record<string, any> = {
      [prefix + 'ProjectName']: { value: prefix + '-project', reportValidity: () => true },
      ...(prefix === 'html' ? { htmlCssStrategy: { value: 'tailwind' } } : {}),
      [prefix + 'PreserveMetadata']: { checked: true },
      [prefix + 'PreserveInteractivity']: { checked: true },
      [prefix + 'ResultCard']: { style: {} },
      [prefix + 'ProgressCard']: { style: {} },
      [prefix + 'ProgressBar']: {},
      [prefix + 'StagesList']: {},
      [prefix + 'Message']: {},
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: prefix + '-conversion' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: prefix + '-conversion', status: 'COMPLETED', stages: [] } }) });
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [{ value: 'https://example.com/' }] }, fetch, proxyHeaders: { 'x-api-key': 'token' } });
    runInContext(scripts, context);
    runInContext(`${prefix}Generator.jobId = '${prefix}-job'; ${prefix}Generator.snapshotJobIds = ['${prefix}-job'];
      set${title}Busy = busy => ${prefix}Generator.busy = busy;
      reset${title}WebsitePreview = () => {}; reset${title}ConversionProgress = () => {};
      set${title}ConversionActivity = () => {}; render${title}Stages = () => {}; render${title}Results = () => {};`, context);
    await runInContext(`execute${title}Conversion()`, context);
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/jobs/${prefix}-job/convert/${prefix}`);
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('token');
    const options = JSON.parse(fetch.mock.calls[0][1].body).options;
    expect(options).toMatchObject({ projectName: prefix + '-project', pages: ['https://example.com/'], snapshotJobIds: [prefix + '-job'], cloneMode: 'single', preserveMetadata: true, preserveInteractivity: true });
    if (prefix === 'exact') expect(options).not.toHaveProperty('cssStrategy');
    else expect(options.cssStrategy).toBe('tailwind');
    expect(fetch.mock.calls[1][0]).toBe(`/api/v1/${prefix}-conversions/${prefix}-conversion`);
    expect(runInContext(`${prefix}Generator.busy`, context)).toBe(false);
    const other = prefix === 'html' ? 'exact' : 'html';
    expect(runInContext(`${other}Generator.conversionId`, context)).toBe('');
  });

  it('keeps preview sessions and file responses isolated while reusing authenticated output APIs', async () => {
    const htmlFrame = { hidden: false, removeAttribute: vi.fn() };
    const exactFrame = { hidden: false, removeAttribute: vi.fn() };
    const elements: Record<string, any> = {
      htmlPreviewFrame: htmlFrame, exactPreviewFrame: exactFrame,
      htmlActiveFilePath: {}, exactActiveFilePath: {}, htmlFileContent: {}, exactFileContent: {},
    };
    const fetch = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => ({ data: { content: url } }) }));
    const context = createContext({ document: { getElementById: (id: string) => elements[id] }, fetch, proxyHeaders: { 'x-api-key': 'secret' } });
    runInContext(scripts, context);
    runInContext("htmlGenerator.conversionId = 'html-record'; exactGenerator.conversionId = 'exact-record'; htmlGenerator.previewBaseUrl = '/html-session/'; exactGenerator.previewBaseUrl = '/exact-session/'; resetExactWebsitePreview();", context);
    expect(htmlFrame.hidden).toBe(false);
    expect(exactFrame.hidden).toBe(true);
    expect(runInContext('htmlGenerator.previewBaseUrl', context)).toBe('/html-session/');
    expect(runInContext('htmlGenerator.previewRequest', context)).toBe(0);
    expect(runInContext('exactGenerator.previewRequest', context)).toBe(1);
    await Promise.all([
      runInContext("selectHtmlFile('index.html')", context),
      runInContext("selectExactFile('pages/about.html')", context),
    ]);
    expect(elements.htmlFileContent.textContent).toBe('/api/v1/html-conversions/html-record/files?path=index.html');
    expect(elements.exactFileContent.textContent).toBe('/api/v1/exact-conversions/exact-record/files?path=pages%2Fabout.html');
    for (const call of fetch.mock.calls) expect(call[1].headers['x-api-key']).toBe('secret');
    expect(renderExactCloneScript()).toContain("exactConversionApi + '/' + encodeURIComponent(exactGenerator.conversionId) + '/download'");
  });

  it('always uses Playwright for Exact capture without any crawler selector', async () => {
    const elements: Record<string, any> = {
      exactTargetUrl: { value: 'example.com' }, exactCloneMode: { value: 'single' }, exactMaxPages: { value: '1' }, exactMessage: {}, btnExactScrape: {},
    };
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Stopped' } }) });
    const context = createContext({ document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [] }, fetch, proxyHeaders: {}, URL, event: { preventDefault: vi.fn() } });
    runInContext(scripts, context);
    runInContext('renderExactScrapeProgress = () => {};', context);
    await runInContext('scrapeExactPage(event)', context);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ targetUrl: 'https://example.com', strategy: 'PLAYWRIGHT', maxPages: 1, maxDepth: 0 });
    expect(runInContext('htmlGenerator.jobId', context)).toBe('');
  });

  it('switches all dashboard views without resetting either generator', () => {
    const $ = load(html);
    const source = $('script').map((_, element) => $(element).html()).get().join('\n');
    const navigation = source.slice(source.indexOf('const dashboardRoutes ='), source.indexOf('function handleProxyToggle'));
    const active = new Map<string, boolean>();
    const title: any = {};
    const context = createContext({ window: { location: { pathname: '/' }, history: { pushState: vi.fn() }, addEventListener: vi.fn() }, document: {
      getElementById: (id: string) => ({ setAttribute: vi.fn(), removeAttribute: vi.fn(), classList: { toggle: (name: string, value: boolean) => active.set(id + ':' + name, value) } }),
      querySelector: () => title,
    } });
    runInContext(scripts + navigation + `
      htmlGenerator.jobId = 'html-job'; exactGenerator.jobId = 'exact-job';
      populateHtmlJobsList = () => {}; populateExactJobsList = () => {};
      populateNextjsJobsList = () => {}; loadProxies = () => {};`, context);
    for (const view of ['exact', 'html', 'nextjs', 'proxies', 'playground']) {
      runInContext(`showView('${view}')`, context);
      for (const candidate of ['exact', 'html', 'nextjs', 'proxies', 'playground']) {
        expect(active.get(candidate + 'View:view-hidden')).toBe(candidate !== view);
        expect(active.get(candidate + 'Nav:active')).toBe(candidate === view);
      }
    }
    expect(runInContext('htmlGenerator.jobId', context)).toBe('html-job');
    expect(runInContext('exactGenerator.jobId', context)).toBe('exact-job');
  });
});
