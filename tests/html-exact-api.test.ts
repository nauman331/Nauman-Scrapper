import fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { htmlConversionRoutes } from '../src/api/routes/html-conversion.routes.js';
import { exactConversionRoutes } from '../src/api/routes/exact-conversion.routes.js';
import { authPlugin } from '../src/api/plugins/auth.plugin.js';
import { ENV } from '../src/config/env.js';
import { createHtmlPreviewSession, getHtmlPreviewConversion } from '../src/generator/html-preview.js';
import { getExactPreviewConversion } from '../src/generator/exact-preview.js';
import { jobRepository } from '../src/persistence/repositories/job.repository.js';
import { resultRepository } from '../src/persistence/repositories/result.repository.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { conversionStorage } from '../src/generator/storage.js';

describe('Independent exact conversion API contract', () => {
  let app: FastifyInstance;
  const ids: string[] = [];
  beforeAll(async () => {
    vi.spyOn(jobRepository, 'getJobById').mockImplementation(async id => id === 'missing' ? null : { id, targetUrl: id === 'foreign' ? 'https://other.test/' : 'https://site.test/', domain: 'site.test' } as never);
    vi.spyOn(resultRepository, 'getResultsByJobId').mockImplementation(async id => ({ items: [{ url: id === 'about' ? 'https://site.test/about' : 'https://site.test/', rawData: { html: '<html><head><style>@layer utilities{.source-box{display:flex}}</style></head><body><div class="source-box" style="padding: 3px;">Static</div><svg><!-- keep --><path d="M0 0L4 4"></path></svg><script>evil()</script></body></html>' } }], total: 1, limit: 200, offset: 0 }) as never);
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '@layer utilities{.source-box{display:flex}}' });
    app = fastify(); await app.register(htmlConversionRoutes); await app.register(exactConversionRoutes); await app.ready();
  });
  afterAll(async () => { await app.close(); await Promise.all(ids.map(id => conversionStorage.deleteConversion(id))); vi.restoreAllMocks(); });
  const start = async (prefix = '/api/v1', mode = 'exact', options = {}, job = 'job') => {
    const response = await app.inject({ method: 'POST', url: `${prefix}/jobs/${job}/convert/${mode}`, payload: { options } });
    if (response.statusCode === 202) ids.push(response.json().data.id);
    return response;
  };
  const poll = async (id: string, namespace = 'exact') => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = (await app.inject(`/api/v1/${namespace}-conversions/${id}`)).json().data;
      if (record.status === 'COMPLETED' || record.status === 'FAILED') return record;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Conversion timed out');
  };
  it('exports exact mode at both aliases through independent status/files/preview/download routes', async () => {
    for (const prefix of ['/api', '/api/v1']) {
      const accepted = await start(prefix, 'exact', { preservationMode: 'exact', snapshotJobIds: ['job', 'about'], pages: ['https://site.test/', 'https://site.test/about'], cloneMode: 'full' });
      expect(accepted.statusCode).toBe(202);
      const initial = accepted.json().data;
      expect(initial).toMatchObject({ format: 'html', exportMode: 'exact', options: { preservationMode: 'exact' } });
      expect(initial.id).toMatch(/^exact_/);
      const record = await poll(initial.id);
      expect((await app.inject(`${prefix}/html-conversions/${initial.id}`)).statusCode).toBe(404);
      expect(record.status).toBe('COMPLETED');
      expect(record.validationReport.passed).toBe(true);
      expect(record.pageFiles.map((page: { path: string }) => page.path)).toEqual(['index.html', 'pages/about.html']);
      expect(record.stages.find((stage: { id: string }) => stage.id === 'preserve-source-css').label).toBe('Preserve Source CSS');
      const file = await app.inject(`${prefix}/exact-conversions/${record.id}/files?path=index.html`);
      expect(file.json().data.content).toContain('class="source-box"');
      expect(file.json().data.content).not.toContain('<svg');
      expect(file.json().data.content).toContain('assets/svgs/svg-');
      expect(record.svgStats).toMatchObject({ detected: 2, extracted: 2, keptInline: 0 });
      expect(file.json().data.content).not.toContain('<script');
      const session = await app.inject({ method: 'POST', url: `${prefix}/exact-conversions/${record.id}/preview` });
      expect(session.json().data.baseUrl).toMatch(new RegExp('^' + prefix + '/exact-preview/[a-f0-9]{64}/$'));
      const token = session.json().data.baseUrl.split('/').filter(Boolean).at(-1);
      expect(getHtmlPreviewConversion(token)).toBeNull();
      expect(getExactPreviewConversion(token)).toBe(record.id);
      const preview = await app.inject(session.json().data.baseUrl + 'index.html');
      expect(preview.statusCode).toBe(200);
      expect(preview.headers['content-security-policy']).toContain("script-src 'none'");
      const download = await app.inject(`${prefix}/exact-conversions/${record.id}/download`);
      expect(download.statusCode).toBe(200); expect(download.rawPayload.subarray(0, 2).toString()).toBe('PK');
      expect(download.rawPayload.toString()).not.toContain('package.json');
      expect((await app.inject(`${prefix}/exact-conversions/${record.id}/files?path=css/output.css`)).statusCode).toBe(404);
    }
  });
  it('leaves ordinary HTML starts unchanged and validates exact options/batched snapshots', async () => {
    const ordinary = await start('/api', 'html', { preservationMode: 'exact' });
    const record = await poll(ordinary.json().data.id, 'html');
    expect(record.options).not.toHaveProperty('preservationMode');
    expect(record.exportMode).toBeUndefined();
    expect((await app.inject(`/api/html-conversions/${record.id}/files?path=css/output.css`)).statusCode).toBe(404);
    expect((await app.inject(`/api/html-conversions/${record.id}/files?path=package.json`)).statusCode).toBe(404);
    expect((await app.inject(`/api/html-conversions/${record.id}/files?path=index.html`)).json().data.content).toContain('https://cdn.tailwindcss.com/3.4.17');
    expect((await app.inject(`/api/exact-conversions/${record.id}`)).statusCode).toBe(404);
    expect((await start('/api', 'exact', { preservationMode: 'convert' })).statusCode).toBe(400);
    expect((await start('/api', 'exact', { cssStrategy: 'original' })).statusCode).toBe(400);
    expect((await start('/api', 'exact', { preservationMode: 'bad' })).statusCode).toBe(400);
    expect((await start('/api', 'exact', { snapshotJobIds: [] })).statusCode).toBe(400);
    expect((await start('/api', 'exact', { projectName: '../escape' })).statusCode).toBe(400);
    expect((await start('/api', 'exact', {}, 'missing')).statusCode).toBe(404);
    const foreign = await start('/api', 'exact', { cloneMode: 'full', snapshotJobIds: ['foreign'] });
    const failed = await poll(foreign.json().data.id);
    expect(failed.status).toBe('FAILED'); expect(failed.errorMessage).toContain('same website');
  });
  it('guards exact APIs and scopes unauthenticated capabilities to exact static previews', async () => {
    const originalKey = ENV.API_KEY;
    ENV.API_KEY = 'exact-test-key';
    const secured = fastify();
    try {
      await secured.register(authPlugin);
      await secured.register(htmlConversionRoutes);
      await secured.register(exactConversionRoutes);
      await secured.ready();
      expect((await secured.inject('/api/v1/exact-conversions/missing')).statusCode).toBe(401);
      expect((await secured.inject({ method: 'POST', url: '/api/jobs/job/convert/exact', payload: {} })).statusCode).toBe(401);
      expect((await secured.inject('/api/exact-preview/not-a-capability/index.html')).statusCode).toBe(401);
      expect((await secured.inject(`/api/exact-preview/${'a'.repeat(64)}/index.html`)).statusCode).toBe(404);
      const htmlToken = createHtmlPreviewSession('html-only');
      expect(getExactPreviewConversion(htmlToken)).toBeNull();
      expect((await secured.inject(`/api/exact-preview/${htmlToken}/index.html`)).statusCode).toBe(404);
      const id = ids.find(id => id.startsWith('exact_'))!;
      const session = await secured.inject({ method: 'POST', url: `/api/v1/exact-conversions/${id}/preview`, headers: { 'x-api-key': 'exact-test-key' } });
      expect(session.statusCode).toBe(200);
      expect((await secured.inject(session.json().data.baseUrl + 'index.html')).statusCode).toBe(200);
      expect((await secured.inject(session.json().data.baseUrl + 'package.json')).statusCode).toBe(404);
      const exactToken = session.json().data.baseUrl.split('/').filter(Boolean).at(-1);
      expect((await secured.inject(`/api/v1/html-preview/${exactToken}/index.html`)).statusCode).toBe(404);
    } finally { await secured.close(); ENV.API_KEY = originalKey; }
  });
});
