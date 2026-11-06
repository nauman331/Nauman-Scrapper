import postcss from 'postcss';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeGeneratedCss } from '../src/generator/css-sanitizer.js';
import { assetCollector } from '../src/generator/assets/asset-collector.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
const id = 'css_source_regression';
afterEach(async () => { vi.restoreAllMocks(); await conversionStorage.deleteConversion(id); });

describe('original stylesheet extraction and conversion', () => {
  it('retains valid CSS around a malformed source rule', () => {
    const source = '.site-header { display:flex; background:#123456; }\n.bad { color:red; broken }\nbody { font-family:Arial; }';
    const recovered = sanitizeGeneratedCss(source, { strategy: 'tailwind' });
    expect(() => postcss.parse(recovered)).not.toThrow();
    expect(recovered).toContain('.site-header');
    expect(recovered).toContain('font-family:Arial');
  });
  it('preserves quoted SVG data URLs containing parentheses through real download and export', async () => {
    const svg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath transform='rotate(180 12 12)' fill='%23fff'/%3E%3C/svg%3E")`;
    const source = `.site-header{display:flex;gap:24px}.badge{background-image:${svg}}body{font-family:Arial;background:#f4f7f8}`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async request => {
      expect(String(request)).toBe('https://site.test/main.css');
      return new Response(source, { headers: { 'content-type': 'text/css' } });
    });
    const html = '<html><head><link rel="stylesheet" href="/main.css"></head><body><header class="site-header"><span class="badge">Badge</span><span>Menu</span></header></body></html>';
    await conversionStorage.setupConversionWorkspace(id);
    const assets = await assetDownloader.resolveAssets(id, assetCollector.collectAssets(html, 'https://site.test/'), [], { generatedPublicAssetUrls: false });
    expect(assets.consolidatedCss).toContain(svg);
    expect(() => postcss.parse(assets.consolidatedCss)).not.toThrow();
    expect(assets.missingAssets).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue(assets);
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }) });
    const residual = (await conversionStorage.readFileSafe(id, 'css/custom.css'))!;
    const preview = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8')) as Record<string, string>;
    const compiled = preview['index.html'];
    const document = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(residual).toBeNull();
    const backgrounds: string[] = [];
    postcss.parse(compiled).walkDecls('background-image', declaration => { backgrounds.push(declaration.value); });
    expect(backgrounds.map(value => value.replace(/\\_/g, '_').replace(/%20/g, ' '))).toContain(svg);
    expect(compiled).toContain('font-family: Arial');
    const gaps: string[] = [];
    postcss.parse(compiled).walkDecls('gap', declaration => { gaps.push(declaration.value); });
    expect(gaps.some(value => value === '24px' || value === '1.5rem')).toBe(true);
    const $ = cheerio.load(document);
    expect($('header').hasClass('flex')).toBe(true);
    expect($('[style], style, link[rel~="stylesheet"]')).toHaveLength(0);
    expect($('script[src]').attr('src')).toBe('https://cdn.tailwindcss.com/3.4.17');
    expect($('script:not([src])').text().trim()).toBe('tailwind.config = { corePlugins: { preflight: false } };');
    expect($('script')).toHaveLength(2);
    expect(result.pageFiles[0].cssPath).toBe('');
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'css'))).rejects.toThrow();
    for (const filename of ['css/output.css', 'css/input.css', 'tailwind.config.cjs', 'package.json', 'README.md', 'tailwind-preview.json']) {
      expect(await conversionStorage.readFileSafe(id, filename)).toBeNull();
    }
    expect(result.conversionStats.declarationsConverted).toBeGreaterThan(0);
    expect(() => postcss.parse(compiled)).not.toThrow();
  });
});
