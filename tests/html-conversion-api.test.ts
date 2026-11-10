import fastify, { type FastifyInstance } from 'fastify';
import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { renderHtmlGeneratorScript, renderHtmlGeneratorWorkspace } from '../src/api/views/html-generator.html.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { htmlConversionRoutes } from '../src/api/routes/html-conversion.routes.js';
import { htmlConversionService } from '../src/generator/html-conversion.service.js';
import { conversionStorage } from '../src/generator/storage.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { jobRepository } from '../src/persistence/repositories/job.repository.js';
import { resultRepository } from '../src/persistence/repositories/result.repository.js';

// Repository boundary mocked: tests exercise the actual HTTP plugin, async exporter, compiler and ZIP.
describe('HTML conversion API', () => {
  let app: FastifyInstance;
  const ids: string[] = [];
  beforeAll(async () => {
    vi.spyOn(jobRepository, 'getJobById').mockImplementation(async (id) => id === 'missing' ? null : { id, targetUrl: 'https://site.test/', domain: 'site.test', name: 'Test' } as never);
    vi.spyOn(resultRepository, 'getResultsByJobId').mockImplementation(async (id) => ({ items: id === 'empty' ? [] : [{ url: id === 'about' ? 'https://site.test/about' : 'https://site.test/', rawData: { html: '<html><head><title>Test</title><style>.box{display:flex}</style></head><body><div class="box">Test</div><script src="/source.js"></script><script>sourceBehavior()</script></body></html>' }, normalizedData: {} }], total: id === 'empty' ? 0 : 1, limit: 200, offset: 0 }) as never);
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '.box{display:flex}' });
    app = fastify();
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(cors, { origin: '*' });
    await app.register(htmlConversionRoutes); await app.ready();
  });
  afterAll(async () => { await app.close(); await Promise.all(ids.map((id) => conversionStorage.deleteConversion(id))); vi.restoreAllMocks(); });
  const start = async (job = 'job', options = {}) => {
    const response = await app.inject({ method: 'POST', url: `/api/jobs/${job}/convert/html`, payload: { options: { cssStrategy: 'tailwind', ...options } } });
    if (response.statusCode === 202) ids.push(response.json().data.id);
    return response;
  };
  const poll = async (id: string) => {
    let record;
    for (let attempt = 0; attempt < 100; attempt++) {
      record = (await app.inject(`/api/html-conversions/${id}`)).json().data;
      if (record.status === 'COMPLETED' || record.status === 'FAILED') return record;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Conversion timed out: ${record?.status}`);
  };
  it('accepts export, polls status, reads query-path files and downloads standalone ZIP', async () => {
    const accepted = await start('job', { projectName: 'html-test' });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().data.status).toBe('PENDING');
    const id = accepted.json().data.id;
    const record = await poll(id);
    expect(record.status, record.errorMessage).toBe('COMPLETED');
    expect(record.format).toBe('html');
    expect(record.options.cssStrategy).toBe('tailwind');
    expect(record.conversionStats.declarationsConverted).toBe(1);
    expect(record.fileTree).toBeDefined();
    const file = await app.inject(`/api/html-conversions/${id}/files?path=index.html`);
    expect(file.statusCode).toBe(200);
    const data = file.json().data;
    const $ = cheerio.load(data.content);
    expect($('div').hasClass('flex')).toBe(true);
    expect($('script[src]').map((_, node) => $(node).attr('src')).get()).toEqual(['https://cdn.tailwindcss.com/3.4.17']);
    expect($('script:not([src])').text().trim()).toBe('tailwind.config = { corePlugins: { preflight: false } };');
    expect($('script')).toHaveLength(2);
    expect(data.content).not.toMatch(/sourceBehavior|source\.js/);
    expect($('[style], style, link[rel~="stylesheet"]')).toHaveLength(0);
    expect(data.previewCss).toContain('display: flex');
    const privatePreview = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8')) as Record<string, string>;
    expect(data.previewCss).toBe(privatePreview['index.html']);
    expect(record.pageFiles[0].cssPath).toBe('');
    for (const filePath of ['css/output.css', 'css/input.css', 'tailwind.config.cjs', 'package.json', 'README.md', 'tailwind-preview.json']) {
      expect((await app.inject(`/api/html-conversions/${id}/files?path=${encodeURIComponent(filePath)}`)).statusCode).toBe(404);
    }
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'css'))).rejects.toThrow();
    const zip = await app.inject(`/api/html-conversions/${id}/download`);
    expect(zip.statusCode).toBe(200); expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toContain('html-test.zip'); expect(zip.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(zip.rawPayload.toString()).toContain('index.html');
    for (const filename of ['package.json', 'tailwind.config', 'README.md', 'css/', 'tailwind-preview.json', 'node_modules']) {
      expect(zip.rawPayload.toString()).not.toContain(filename);
    }
    expect((await app.inject(`/api/v1/html-conversions/${id}`)).statusCode).toBe(200);
  });
  it('accepts Core CSS, validates external files and serves previews and ZIPs without Tailwind tooling', async () => {
    const accepted = await start('job', { cssStrategy: 'core', projectName: 'core-test' });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().message).toContain('Core CSS');
    const id = accepted.json().data.id;
    const record = await poll(id);
    expect(record.status).toBe('COMPLETED');
    expect(record.validationReport.passed).toBe(true);
    expect(record.stages.some((stage: { id: string }) => stage.id === 'compile-tailwind')).toBe(false);
    const file = await app.inject(`/api/html-conversions/${id}/files?path=index.html`);
    expect(file.json().data.content).toContain('class="box"');
    expect(file.json().data.content).toContain('href="css/core.css"');
    expect(file.json().data.content).not.toMatch(/style=|<style/);
    const session = await app.inject({ method: 'POST', url: `/api/html-conversions/${id}/preview` });
    const css = await app.inject(session.json().data.baseUrl + 'css/core.css');
    expect(css.headers['content-type']).toContain('text/css');
    expect(css.body.startsWith('/* it is converted from inline CSS to external CSS */')).toBe(true);
    expect(css.body).toContain('.box{display:flex}');
    const zip = await app.inject(`/api/html-conversions/${id}/download`);
    expect(zip.statusCode).toBe(200);
    expect(zip.rawPayload.toString()).not.toContain('tailwind.config.cjs');
    expect(zip.rawPayload.toString()).not.toContain('package.json');
  });
  it('packages existing single-page snapshots together through the unchanged exporter', async () => {
    const accepted = await start('job', { cloneMode: 'full', snapshotJobIds: ['job', 'about'], pages: ['https://site.test/', 'https://site.test/about'] });
    const record = await poll(accepted.json().data.id);
    expect(record.status, record.errorMessage).toBe('COMPLETED');
    expect(record.pageFiles.map((page: { path: string }) => page.path)).toEqual(['index.html', 'pages/about.html']);
    for (const path of ['index.html', 'pages/about.html']) {
      const file = await app.inject(`/api/html-conversions/${record.id}/files?path=${encodeURIComponent(path)}`);
      expect(cheerio.load(file.json().data.content)('div').hasClass('flex')).toBe(true);
      expect(file.json().data.previewCss).toContain('display: flex');
    }
  });
  it('serves script-free sandboxed HTML with private styles and binary assets through scoped previews', async () => {
    const accepted = await start('job');
    const id = accepted.json().data.id;
    await poll(id);
    const session = await app.inject({ method: 'POST', url: `/api/v1/html-conversions/${id}/preview` });
    expect(session.statusCode).toBe(200);
    const baseUrl = session.json().data.baseUrl;
    expect(baseUrl).toMatch(/^\/api\/v1\/html-preview\/[a-f0-9]{64}\/$/);
    const page = await app.inject(baseUrl + 'index.html');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const preview = cheerio.load(page.body);
    expect(preview('div').hasClass('flex')).toBe(true);
    expect(preview('script')).toHaveLength(0);
    expect(page.body).not.toContain('cdn.tailwindcss.com');
    const exported = (await app.inject(`/api/html-conversions/${id}/files?path=index.html`)).json().data;
    expect(preview('style').text()).toBe(exported.previewCss);
    expect(page.headers['content-security-policy']).toContain('sandbox;');
    expect(page.headers['content-security-policy']).toContain("script-src 'none'");
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect((await app.inject(baseUrl + 'css/output.css')).statusCode).toBe(404);
    expect((await app.inject(baseUrl + 'tailwind-preview.json')).statusCode).toBe(404);
    const bytes = Buffer.from([0, 255, 128, 42]);
    await conversionStorage.writeFileSafe(id, 'assets/test.png', bytes);
    const image = await app.inject(baseUrl + 'assets/test.png');
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.rawPayload).toEqual(bytes);
    expect((await app.inject(baseUrl + 'package.json')).statusCode).toBe(404);
    expect((await app.inject(baseUrl + '..%2F..%2Foutside.html')).statusCode).toBe(400);
    expect((await app.inject(baseUrl + 'absent.html')).statusCode).toBe(404);
    expect((await app.inject('/api/v1/html-preview/' + '0'.repeat(64) + '/index.html')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/html-conversions/missing/preview' })).statusCode).toBe(404);
  });
  it.skipIf(!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe'))('loads preview HTML and assets in a real browser with production security headers', async () => {
    const accepted = await start('job');
    const id = accepted.json().data.id;
    await poll(id);
    const server = fastify();
    await server.register(helmet, { contentSecurityPolicy: false });
    await server.register(cors, { origin: '*' });
    await server.register(htmlConversionRoutes);
    server.get('/', async (_request, reply) => reply.type('text/html').send('<html><body>' + renderHtmlGeneratorWorkspace() + '<script>const proxyHeaders = { "Content-Type": "application/json" };' + renderHtmlGeneratorScript() + '</script></body></html>'));
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(5000);
      await page.goto(address);
      // Reproduce a failed raw HTML request: the controller should still render
      // using the working JSON file endpoint, not gate the preview on that fetch.
      await page.route('**/html-preview/**/index.html', route => route.abort('failed'));
      await page.route('https://cdn.tailwindcss.com/**', route => route.abort('failed'));
      await page.evaluate(async (conversionId) => {
        document.getElementById('htmlResultCard')!.style.display = 'block';
        (document.getElementById('htmlPreviewPage') as HTMLSelectElement).innerHTML = '<option value="index.html">index.html</option>';
        (0, eval)('htmlGenerator.conversionId = ' + JSON.stringify(conversionId));
        await (0, eval)('loadHtmlWebsitePreview()');
      }, id);
      expect(await page.locator('#htmlPreviewStatus').textContent()).not.toContain('Preview unavailable');
      await page.waitForFunction(() => document.getElementById('htmlPreviewStatus')?.textContent?.includes('Showing index.html'), { timeout: 5000 });
      const content = page.frameLocator('#htmlPreviewFrame').locator('div.flex');
      await content.waitFor({ state: 'visible' });
      expect(await content.evaluate(element => getComputedStyle(element).display)).toBe('flex');
      expect(await page.frameLocator('#htmlPreviewFrame').locator('script').count()).toBe(0);
      expect(await page.frameLocator('#htmlPreviewFrame').locator('style').textContent()).toContain('display: flex');
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30000);
  it('validates options, unknown IDs, traversal, missing paths and incomplete ZIPs', async () => {
    expect((await start('job', { cssStrategy: 'original' })).statusCode).toBe(400);
    expect((await start('job', { projectName: '../escape' })).statusCode).toBe(400);
    expect((await start('missing')).statusCode).toBe(404);
    expect((await app.inject('/api/html-conversions/missing')).statusCode).toBe(404);
    expect((await app.inject('/api/html-conversions/missing/download')).statusCode).toBe(404);
    const accepted = await start('empty'); const id = accepted.json().data.id;
    const record = await poll(id); expect(record.status).toBe('FAILED'); expect(record.errorMessage).toContain('No captured');
    expect((await app.inject(`/api/html-conversions/${id}/download`)).json().error.code).toBe('ZIP_NOT_READY');
    expect((await app.inject(`/api/html-conversions/${id}/files`)).statusCode).toBe(400);
    expect((await app.inject(`/api/html-conversions/${id}/files?path=..%2Foutside`)).statusCode).toBe(400);
    expect((await app.inject(`/api/html-conversions/${id}/files?path=absent.html`)).statusCode).toBe(404);
  });
  it('paginates the full captured inventory beyond 200 results', async () => {
    const spy = vi.spyOn(resultRepository, 'getResultsByJobId');
    const batch = (offset: number, count: number) => ({ items: Array.from({ length: count }, (_, index) => ({
      url: `https://site.test/page-${offset + index}`, rawData: { html: '<html><head><title>Page</title></head><body>Page</body></html>' }, normalizedData: {},
    })), total: 250, limit: 200, offset });
    spy.mockResolvedValueOnce(batch(0, 200) as never).mockResolvedValueOnce(batch(200, 50) as never);
    const response = await app.inject('/api/v1/jobs/job/convert/preview');
    expect(response.statusCode).toBe(200);
    expect(response.json().data.totalPages).toBe(250);
    expect(response.json().data.pages[249].url).toBe('https://site.test/page-249');
    expect(spy).toHaveBeenCalledWith('job', expect.objectContaining({ limit: 25, offset: 200 }));
  });
  it('reuses job inventory preview at both prefix aliases', async () => {
    expect((await app.inject('/api/jobs/job/convert/preview')).json().data.jobId).toBe('job');
    expect((await app.inject('/api/v1/jobs/job/convert/preview')).statusCode).toBe(200);
  });
});
