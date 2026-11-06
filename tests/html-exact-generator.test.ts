import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportExactHtml, sanitizeExactHtml } from '../src/generator/exact-exporter.js';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { ExactConversionOptionsSchema } from '../src/generator/exact-types.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';
import { HtmlSvgProcessor } from '../src/generator/assets/svg-processor.js';
import * as migration from '../src/generator/analyzer/tailwind-converter.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
const ids: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(ids.splice(0).map(id => conversionStorage.deleteConversion(id))); });
const icon = '<svg class="brand-icon" viewBox="0 0 24 24"><!-- keep this artwork --><path id="art" fill="#123456" d="M0 0L24 0L24 24Z"></path></svg>';
const css = '@layer base, components, utilities; @layer utilities{.flex{display:flex}} .source-card{display:grid;padding:12px;background:url(/bg.png)}';
const fixture = '<html><head><style>.source-card{color:red}</style><link rel="stylesheet" href="/compiled.css" media="screen"><style>.source-card{color:blue}</style></head><body class="source-body"><section class="source-card flex" style="font-weight: 700; margin: 3px;">' + icon + '<img src="/logo.svg"><a href="/about">About</a><script>evil()</script><form action="/submit"><button onclick="evil()">Send</button></form></section></body></html>';
const run = async (preservationMode: 'exact' | 'convert' = 'exact') => {
  const id = `exact_test_${Date.now()}_${ids.length}`; ids.push(id);
  const input = { conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: fixture } }, { url: 'https://site.test/about', rawData: { html: fixture } }] };
  const result = preservationMode === 'exact'
    ? await exportExactHtml({ ...input, options: ExactConversionOptionsSchema.parse({ cloneMode: 'full' }) })
    : await exportStandaloneHtml({ ...input, options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', cloneMode: 'full' }) });
  return { id, result };
};
const mockFetch = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async request => {
  const url = String(request);
  if (url.endsWith('/compiled.css')) return new Response(css, { headers: { 'content-type': 'text/css' } });
  if (url.endsWith('/logo.svg')) return new Response(icon, { headers: { 'content-type': 'image/svg+xml' } });
  if (url.endsWith('/bg.png')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  return new Response('missing', { status: 404 });
});

describe('Exact static HTML preservation', () => {
  it('preserves source presentation hooks while removing executable URLs, CSS and handlers', () => {
    const warnings: string[] = [];
    const html = sanitizeExactHtml('<body class="modal-open source" style="overflow:hidden"><dialog open class="source-modal">Notice</dialog><p style="color:red;behavior:url(evil.htc);width:expression(evil())" onclick="evil()">Safe</p><svg><a xlink:href="javascript:evil()">Link</a></svg><form action="/checkout"><button formaction="/pay">Pay</button></form></body>', warnings);
    expect(html).toContain('class="modal-open source"');
    expect(html).toContain('style="overflow:hidden"');
    expect(html).toContain('<dialog open="" class="source-modal">');
    expect(html).not.toMatch(/onclick=|action=|javascript:|expression\(|behavior:/);
    expect(html).toContain('<form inert="">');
  });
  it('preserves classes/styles and extracts SVG with source layers without migration or tooling', async () => {
    mockFetch();
    const migrate = vi.spyOn(migration, 'convertDocumentsToTailwind');
    const process = vi.spyOn(HtmlSvgProcessor.prototype, 'process');
    const { id, result } = await run();
    expect(migrate).not.toHaveBeenCalled(); expect(process).toHaveBeenCalledTimes(2);
    expect(result.conversionStats.declarationsConverted).toBe(0);
    expect(result.svgStats).toMatchObject({ detected: 2, keptInline: 0, extracted: 2, assetsCreated: 1, reused: 1 });
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    const $ = cheerio.load(html);
    expect($('section').attr('class')).toBe('source-card flex');
    expect($('section').attr('style')).toBe('font-weight: 700; margin: 3px;');
    expect($('svg')).toHaveLength(0);
    const extractedSvg = (await conversionStorage.readFileSafe(id, $('img.brand-icon').attr('src')!))!;
    expect(extractedSvg).toContain('viewBox="0 0 24 24"');
    expect(extractedSvg).toContain('d="M0 0L24 0L24 24Z"');
    expect(extractedSvg).not.toContain('keep this artwork');
    expect($('head').children().map((_, el) => el.tagName).get()).toEqual(['style', 'link', 'style']);
    expect($('link').attr('media')).toBe('screen');
    const sourcePath = $('link').attr('href')!;
    const sourceCss = (await conversionStorage.readFileSafe(id, sourcePath))!;
    expect(sourceCss).toContain('@layer base, components, utilities');
    expect(sourceCss).toContain('@layer utilities{.flex{display:flex}}');
    expect(sourceCss).not.toContain('source-utilities');
    expect(sourceCss).toContain('../../assets/images/backgrounds/');
    const svgAsset = $('img:not(.brand-icon)').attr('src')!;
    expect(await conversionStorage.readFileSafe(id, svgAsset)).toBe(icon);
    expect(html).toContain('href="pages/about.html"');
    expect(html).not.toMatch(/<script|onclick=|action=/);
    expect(html).toContain('<form inert="">');
    for (const file of ['package.json', 'tailwind.config.cjs', 'css/input.css', 'css/output.css']) expect(await conversionStorage.readFileSafe(id, file)).toBeNull();
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'public'))).rejects.toThrow();
    const readme = (await conversionStorage.readFileSafe(id, 'README.md'))!;
    expect(readme).toContain('No installation or CSS build is required');
    expect(readme).not.toContain('npm install');
    const tree = await conversionStorage.buildFileTree(id);
    const count = (node: typeof tree): number => node.type === 'file' ? 1 : (node.children || []).reduce((sum, child) => sum + count(child), 0);
    expect(result.totalFilesGenerated).toBe(count(tree));
  });
  it('localizes nested imports in inline source styles without changing their cascade position', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async request => String(request).endsWith('/nested.css')
      ? new Response('.imported{background:url(/bg.png)}', { headers: { 'content-type': 'text/css' } })
      : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
    const id = `exact_test_${Date.now()}_${ids.length}`; ids.push(id);
    await exportExactHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<head><style>@import "/nested.css"; .imported{color:red}</style></head><body class="imported">Test</body>' } }], options: ExactConversionOptionsSchema.parse({}) });
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(html).toContain('.imported{background:url("assets/images/backgrounds/');
    expect(html).toContain('.imported{color:red}');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('https://site.test/');
  });
  it('cleans every captured page before asset collection and formats HTML without altering pre/text/CSS', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }));
    const id = `exact_test_${Date.now()}_${ids.length}`; ids.push(id);
    const html = '<html><head><style>.article { color: red; }</style></head><body style="overflow:hidden"><div class="newsletter-popup"><img src="/advert.png"></div><main><article><p>Hello <strong>world</strong>!</p><pre>  first\n    second &amp; third\n</pre></article></main></body></html>';
    const result = await exportExactHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html } }, { url: 'https://site.test/saved', rawData: { html } }], options: ExactConversionOptionsSchema.parse({ cloneMode: 'full' }) });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.removedWidgets).toBe(2);
    expect(result.warnings.join(' ')).toContain('removed 2');
    for (const output of result.pageFiles) {
      const formatted = (await conversionStorage.readFileSafe(id, output.path))!;
      const $ = cheerio.load(formatted);
      expect($('.newsletter-popup')).toHaveLength(0);
      expect($('body').attr('style')).toContain('overflow:auto!important');
      expect($('pre').text()).toBe('  first\n    second & third\n');
      expect($('p').text()).toBe('Hello world!');
      expect($('style').text().trim()).toBe('.article { color: red; }');
      expect(formatted).toMatch(/\n\s+><head/);
      expect(formatted).toMatch(/\n\s+><article/);
    }
  });
  it('externalizes SVG with source selector paint, inherited variables, media and fragment dependencies', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async request => String(request).endsWith('/paint.css')
      ? new Response('.theme{color:#123456;--paint:#abcdef}.theme .art path{fill:var(--paint);stroke:currentColor;filter:url(#shadow)}@media(min-width:600px){.art{width:24px}}', { headers: { 'content-type': 'text/css' } })
      : String(request).endsWith('/texture.png')
        ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
        : new Response('missing', { status: 404 }));
    const id = `exact_test_${Date.now()}_${ids.length}`; ids.push(id);
    const html = '<head><link rel="stylesheet" href="/paint.css"></head><body class="theme"><main><svg class="art" viewBox="0 0 24 24"><path d="M0 0L24 24"/><image href="/texture.png"/></svg><svg hidden><defs><filter id="shadow"><feGaussianBlur stdDeviation="2"/></filter><symbol id="sprite"><path d="M1 1L2 2"/></symbol></defs></svg><svg viewBox="0 0 4 4"><use href="#sprite"/></svg><p>Artwork</p></main></body>';
    const result = await exportExactHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html } }], options: ExactConversionOptionsSchema.parse({}) });
    const $ = cheerio.load((await conversionStorage.readFileSafe(id, 'index.html'))!);
    expect($('svg')).toHaveLength(0);
    expect(result.svgStats.extracted).toBe(3);
    const markup = (await conversionStorage.readFileSafe(id, $('img.art').attr('src')!))!;
    expect($('img.art').attr('src')).toMatch(/^assets\/svgs\/svg-.*\.svg$/);
    expect(markup).toContain('--paint:#abcdef');
    expect(markup).toContain('fill:var(--paint)');
    expect(markup).toContain('stroke:currentColor');
    expect(markup).toContain('data-svg-node');
    expect(markup).toContain('@media');
    expect(markup).toContain('id="shadow"');
    expect(cheerio.load(markup, { xmlMode: true })('style').text()).toMatch(/url\(["']?#shadow/);
    expect(markup).toContain('d="M0 0L24 24"');
    const imageHref = cheerio.load(markup, { xmlMode: true })('image').attr('href')!;
    expect(imageHref).toMatch(/^\.\.\/images\//);
    expect(await conversionStorage.readFileSafe(id, path.posix.normalize(path.posix.join('assets/svgs', imageHref)))).not.toBeNull();
    const instance = (await conversionStorage.readFileSafe(id, $('img').last().attr('src')!))!;
    expect(instance).toContain('id="sprite"');
    expect(instance).toContain('href="#sprite"');
    expect(result.warnings.join(' ')).toContain('image boundary');
    const readme = (await conversionStorage.readFileSafe(id, 'README.md'))!;
    expect(readme).toContain('Inline SVG artwork is extracted');
    expect(readme).toContain('without migration or recompilation');
  });
  it('keeps Exact isolation while explicitly selected Tailwind uses the CDN-only contract', async () => {
    mockFetch();
    expect(HtmlConversionOptionsSchema.parse({})).not.toHaveProperty('preservationMode');
    expect(ExactConversionOptionsSchema.parse({}).preservationMode).toBe('exact');
    expect(ExactConversionOptionsSchema.safeParse({ preservationMode: 'convert' }).success).toBe(false);
    expect(HtmlConversionOptionsSchema.parse({}).cssStrategy).toBe('tailwind');
    expect(HtmlConversionOptionsSchema.safeParse({ cssStrategy: 'original' }).success).toBe(false);
    const { id, result } = await run('convert');
    expect(result.conversionStats.declarationsConverted).toBeGreaterThan(0);
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    const $ = cheerio.load(html);
    expect($('script[src]').map((_, node) => $(node).attr('src')).get()).toEqual(['https://cdn.tailwindcss.com/3.4.17']);
    expect($('script:not([src])').text().trim()).toBe('tailwind.config = { corePlugins: { preflight: false } };');
    expect($('script')).toHaveLength(2);
    expect(html).not.toContain('evil()');
    expect($('[style], style, link[rel~="stylesheet"]')).toHaveLength(0);
    expect(result.pageFiles.every(page => page.cssPath === '')).toBe(true);
    const preview = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8')) as Record<string, string>;
    expect(preview['index.html']).toContain('display:');
    for (const file of ['css/output.css', 'css/input.css', 'tailwind.config.cjs', 'package.json', 'README.md', 'tailwind-preview.json']) {
      expect(await conversionStorage.readFileSafe(id, file)).toBeNull();
    }
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'css'))).rejects.toThrow();
  });
});
