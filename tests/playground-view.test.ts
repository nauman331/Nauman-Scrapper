import { describe, expect, it, vi } from 'vitest';
import { createContext, runInContext } from 'node:vm';
import { load } from 'cheerio';
import { renderPlaygroundHtml } from '../src/api/views/playground.html.js';

describe('playground crawl scope', () => {
  const html = renderPlaygroundHtml();

  it.each([
    ['testProxy', 'POST', '/api/v1/proxies/proxy-test/test', 200],
    ['deleteProxy', 'DELETE', '/api/v1/proxies/proxy-test', 204],
  ])('sends a JSON body and retains authentication for %s', async (action, method, url, status) => {
    const $ = load(html);
    const source = $('script').map((_, element) => $(element).html()).get().join('\n');
    const request = source.slice(source.indexOf('    async function proxyRequest('), source.indexOf('    async function loadProxies()'));
    const actions = source.slice(source.indexOf('    async function testProxy('), source.indexOf('    /* Next.js Generator Controller */'));
    const json = vi.fn().mockResolvedValue({ data: {} });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status, json });
    const refresh = vi.fn();
    const message = { innerText: '' };
    const context = createContext({
      document: { getElementById: () => message }, fetch,
      proxyHeaders: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      confirm: vi.fn().mockReturnValue(true), loadProxies: refresh,
    });
    runInContext(request + actions, context);
    await runInContext(action + "('proxy-test')", context);
    expect(fetch).toHaveBeenCalledWith(url, {
      method, body: '{}', headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
    });
    expect(refresh).toHaveBeenCalledOnce();
    if (status === 204) expect(json).not.toHaveBeenCalled();
    else expect(message.innerText).toBe('Test complete.');
  });

  it('renders accessible crawl scope choices and constrained page count', () => {
    expect(html).toContain('<legend class="form-label">Crawl Scope</legend>');
    expect(html).toContain('value="landing" checked');
    expect(html).toContain('value="count"');
    expect(html).toContain('value="full"');
    expect(html).toContain('value="specific"');
    expect(html).toContain('id="specificPageKeywords"');
    expect(html).toContain('about us\ncontact us');
    expect(html).toContain('id="specificMaxPages"');
    expect(html).toContain('type="number" min="2" max="500"');
    expect(html).toContain('not raw regex');
    expect(html).toContain('type="number" min="1" max="500"');
    expect(html).toContain('Full website<small>Crawl internal links, up to 500 pages.');
  });

  it('selects specific scope when its controls are focused or edited', () => {
    expect(html).toContain('onfocus="handleSpecificSettingsChange()" oninput="handleSpecificSettingsChange()"');
    expect(html).toContain('function selectSpecificScope()');
    expect(html).toContain('specificScope.checked = true;');
    expect(html).toContain('selectSpecificScope();\n      validateSpecificSettings(false);\n      updateCodeSnippet();');
    expect(html).not.toContain('dispatchEvent(new Event');
  });

  it('explains why a slash alone is not a specific-page phrase', () => {
    expect(html).toContain('A slash by itself is invalid because the landing page is already included.');
    expect(html).toContain("hasRawInput && keywords.length === 0 ? 'Enter a phrase containing letters or numbers. A slash alone is not a page phrase; the landing page is already included.'");
  });

  it('maps scopes, filters internal links, and retrieves paginated results', () => {
    expect(html).toContain("maxDepth: 0, maxPages: 1, discoverLinks: false");
    expect(html).toContain("maxDepth: 10, maxPages: 500, discoverLinks: true");
    expect(html).toContain("discoverLinks: pageCount > 1");
    expect(html).toContain('filterInternalLinksOnly: true');
    expect(html).toContain("specificPageKeywords: settings.crawlScope === 'specific' ? settings.specificPageKeywords : []");
    expect(html).toContain("maxDepth: 10, maxPages: clampSpecificMaxPages");
    expect(html).toContain('results?limit=');
    expect(html).toContain('while (offset < total)');
  });

  it('uses an accurate POST sample and persists crawl scope settings', () => {
    expect(html).toContain("curl --request POST --location 'http://localhost:3200/api/v1/jobs'");
    expect(html).toContain("--header 'Content-Type: application/json'");
    expect(html).toContain('crawlScope: settings.crawlScope');
    expect(html).toContain('pageCount: settings.pageCount');
    expect(html).toContain('run.crawlScope');
    expect(html).toContain('run.specificPageKeywords');
    expect(html).toContain('specificPageKeywords: settings.specificPageKeywords || []');
    expect(html).toContain("document.getElementById('specificPageKeywords').value = 'about us\\ncontact us'");
  });

  it('keeps the Render JavaScript checkbox synchronized with the crawler engine', () => {
    expect(html).toContain('onchange="handleStrategyChange()"');
    expect(html).toContain("document.getElementById('renderJs').checked = document.getElementById('strategy').value === 'PLAYWRIGHT';");
    expect(html).toContain("document.getElementById('strategy').value = isJs ? 'PLAYWRIGHT' : 'AUTO';");
  });

  it('synchronizes Render JavaScript when restoring a history run without dispatching change events', () => {
    expect(html).toContain("document.getElementById('strategy').value = run.strategy || 'AUTO';\n      syncRenderJsWithStrategy();");
    expect(html).not.toContain("dispatchEvent(new Event('change'))");
  });

  it('supports Clean Data fetching, viewing, history, and extraction payload', () => {
    expect(html).toContain('id="tabCleanData"');
    expect(html).toContain("setResponseView('clean')");
    expect(html).toContain('currentCleanData = await fetchCleanData(jobId, apiKey).catch(() => null);');
    expect(html).toContain('/clean-data');
    expect(html).toContain('cleanData: currentCleanData');
    expect(html).toContain('currentCleanData = run.cleanData ?? null;');
    expect(html).toContain('extractImages: true');
    expect(html).toContain('extractJsonLd: true');
  });

  it('renders Next.js Project Generator navigation, options, timeline, and export UI', () => {
    expect(html).toContain('id="nextjsNav"');
    expect(html).toContain("showView('nextjs')");
    expect(html).toContain('id="btnNextjsAction"');
    expect(html).toContain('id="nextjsView"');
    expect(html).toContain('Next.js Project Generator');
    expect(html).toContain('id="nextjsProjectName"');
    expect(html).toContain('id="nextjsCssStrategy"');
    expect(html).toContain('id="nextjsExtractionLevel"');
    expect(html).toContain('id="nextjsPreserveInteractivity"');
    expect(html).toContain('id="nextjsPreserveMetadata"');
    expect(html).toContain('id="nextjsPagesTable"');
    expect(html).toContain('id="btnStartConversion"');
    expect(html).toContain('id="nextjsProgressCard"');
    expect(html).toContain('id="nextjsStagesList"');
    expect(html).toContain('id="nextjsResultCard"');
    expect(html).toContain('id="nextjsFileTree"');
    expect(html).toContain('id="btnDownloadZip"');
    expect(html).toContain('Download Project ZIP');
  });
});
