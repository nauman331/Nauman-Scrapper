import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportStandaloneHtml, sanitizeStandaloneHtml, externalizeInlineStyles } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { mapHtmlPageFiles } from '../src/generator/html-project-structure.js';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import { format } from 'prettier';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { convertDocumentToCoreCss, CORE_CSS_COMMENT } from '../src/generator/analyzer/core-css-converter.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));

const ids: string[] = [];
const makeId = () => { const id = `html_test_${Date.now()}_${ids.length}`; ids.push(id); return id; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(ids.splice(0).map((id) => conversionStorage.deleteConversion(id))); });
const pages = [
  { url: 'https://site.test/', rawData: { html: '<html lang="fr"><head><title>Home</title><meta name="description" content="Test"><style>.hero{display:flex;padding:12px} body{font-family:Custom}</style></head><body class="home"><a href="/blog/post/#section">Post</a><div class="hero">Hello</div></body></html>' } },
  { url: 'https://site.test/blog/post/', rawData: { html: '<html lang="fr"><head><title>Post</title><link rel="stylesheet" href="/styles/main.css"></head><body><a href="/">Home</a><img src="/logo.png"><div class="hero" style="font-weight:700">Post</div><details><summary>Native</summary>Open</details></body></html>' } },
];

describe('HTML + Core CSS', () => {
  it('assigns collision-free meaningful classes, groups duplicate styles and retains priority and fallback order', () => {
    const result = convertDocumentToCoreCss('<div id="hero" class="original core-inline" style="color:red;color:blue;--gap:10px"><span style="color:red;color:blue;--gap:10px">Child</span></div><p style="color:green!important"></p><i style=""></i>', '#hero{color:black}@layer base{p{color:red!important}}');
    const $ = cheerio.load(result.html);
    expect($('[style]')).toHaveLength(0);
    expect($('#hero').hasClass('original')).toBe(true);
    const classes = $('div, span, p').map((_, element) => $(element).attr('class')!.split(' ').at(-1)).get();
    expect(new Set(classes).size).toBe(3);
    expect(classes[0]).toContain('core-inline-export-hero-');
    expect(result.css.startsWith(CORE_CSS_COMMENT)).toBe(true);
    const root = postcss.parse(result.css);
    const shared = root.nodes.find(node => node.type === 'rule' && node.selector.includes(classes[0])) as postcss.Rule;
    expect(shared.selector).toContain(classes[1]);
    expect(shared.nodes.filter(node => node.type === 'decl').map(node => node.value)).toEqual(['red', 'blue', '10px']);
    expect(result.css).toContain('!important');
    expect(result.stats.inlineDeclarationsConverted).toBe(7);
  });

  it('exports isolated page CSS, inline assets and SVG styling without Tailwind or final commands', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockImplementation(async conversionId => {
      await conversionStorage.writeFileSafe(conversionId, 'public/images/bg.png', Buffer.from([137, 80, 78, 71]));
      return { downloadedAssets: [{ originalUrl: 'https://site.test/bg.png', localPath: 'public/images/bg.png', publicUrl: '/images/bg.png', mimeType: 'image/png', sizeBytes: 4, hash: 'bg', isSvg: false, isFont: false, isStylesheet: false, isImage: true }], missingAssets: [], consolidatedCss: '@layer base{.hero{display:grid}} .hero:hover{color:blue}@media(max-width:600px){.hero{width:100%}}svg path{fill:currentColor}' };
    });
    const stage = vi.fn();
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', stage,
      pages: ['https://site.test/', 'https://site.test/about/'].map(url => ({ url, rawData: { html: '<html><head><style>.hero{padding:10px}</style></head><body><div id="hero" class="hero" style="background:url(/bg.png);width:400px;color:red!important">Hello<svg viewBox="0 0 24 24" style="width:24px"><path style="opacity:.5" d="M0 0L24 24"/></svg></div></body></html>' } })),
      options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'core', cloneMode: 'full' }) });
    expect(result.pageFiles.map(page => page.cssPath)).toEqual(['css/core.css', 'css/pages/about.css']);
    for (const page of result.pageFiles) {
      const html = (await conversionStorage.readFileSafe(id, page.path))!;
      const $ = cheerio.load(html);
      expect($('[style], style')).toHaveLength(0);
      expect($('#hero').hasClass('hero')).toBe(true);
      expect($('svg path')).toHaveLength(1);
      expect(html).toContain(page.path === 'index.html' ? 'href="css/core.css"' : 'href="../css/pages/about.css"');
      expect(html).not.toContain('css/output.css');
      const css = (await conversionStorage.readFileSafe(id, page.cssPath))!;
      expect(css.startsWith(CORE_CSS_COMMENT)).toBe(true);
      expect(css).toContain('@layer base');
      expect(css).toContain('.hero:hover');
      expect(css).toContain('@media');
      expect(css).toContain('svg path');
      expect(css).toContain(page.path === 'index.html' ? '../assets/images/' : '../../assets/images/');
      expect(css).not.toContain('url("assets/');
      expect(() => postcss.parse(css)).not.toThrow();
    }
    expect(stage.mock.calls.some(([id]) => id === 'compile-tailwind')).toBe(false);
    for (const file of ['css/output.css', 'css/input.css', 'tailwind.config.cjs', 'package.json']) expect(await conversionStorage.readFileSafe(id, file)).toBeNull();
  });

  it.skipIf(!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe'))('preserves computed layout, inline priority, responsive styles and hover in a browser', async () => {
    const css = '@layer base{#hero{color:purple!important}} #hero{width:90px;color:black} .hero:hover{background:blue} @media(max-width:600px){.hero{padding:8px}}';
    const html = '<div id="hero" class="hero" style="display:flex;width:240px;color:red!important;gap:12px"><span style="font-size:18px">Text</span></div>';
    const converted = convertDocumentToCoreCss(html, css);
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      const capture = () => page.locator('#hero').evaluate(element => { const style = getComputedStyle(element); return { width: style.width, display: style.display, color: style.color, gap: style.gap, padding: style.padding, background: style.backgroundColor }; });
      for (const width of [1000, 500]) {
        await page.setViewportSize({ width, height: 700 });
        await page.setContent(`<style>${css}</style>${html}`);
        await page.locator('#hero').hover();
        const before = await capture();
        await page.route('https://core.test/external.css', route => route.fulfill({ contentType: 'text/css', body: converted.css }));
        await page.setContent(converted.html.replace('<head>', '<head><link rel="stylesheet" href="https://core.test/external.css">'));
        await page.locator('#hero').hover();
        expect(await capture()).toEqual(before);
      }
    } finally { await browser.close(); }
  });
});

const readTailwindPreviewCss = async (id: string, page = 'index.html'): Promise<string> => {
  const preview = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8')) as Record<string, string>;
  expect(preview[page]).toEqual(expect.any(String));
  return preview[page];
};
const expectCdnExport = async (id: string, html: string) => {
  const $ = cheerio.load(html);
  expect($('script[src]').map((_, node) => $(node).attr('src')).get()).toEqual(['https://cdn.tailwindcss.com/3.4.17']);
  expect($('script:not([src])').map((_, node) => $(node).text().trim()).get()).toEqual(['tailwind.config = { corePlugins: { preflight: false } };']);
  expect($('script')).toHaveLength(2);
  expect($('[style], style, link[rel~="stylesheet"], link[as="style"]')).toHaveLength(0);
  expect(html).toBe(await format(html, { parser: 'html', printWidth: 120, htmlWhitespaceSensitivity: 'strict' }));
  for (const file of ['css/output.css', 'css/input.css', 'tailwind.config.cjs', 'tailwind.config.js', 'package.json', 'README.md', 'tailwind-preview.json']) {
    expect(await conversionStorage.readFileSafe(id, file)).toBeNull();
  }
  await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'css'))).rejects.toThrow();
};

describe('Standalone HTML + Tailwind exporter', () => {
  it('externalizes residual inline CSS into reusable classes with the requested comment', () => {
    const result = externalizeInlineStyles('<div class="review" style="margin:0 auto;filter:blur(2px)">A</div><p style="margin:0 auto;filter:blur(2px)">B</p>', '#main .review{margin-left:0}', 'home');
    expect(result.html).not.toContain('style=');
    expect(result.html).toContain('converted-inline-home-1');
    expect(result.css).toContain('/* converted from inline CSS to external CSS */');
    expect(result.css).toContain('margin:0 auto');
    expect(result.css).toContain('filter:blur(2px)');
    expect(result.css.match(/\{ /g)).toHaveLength(1);
  });
  it('maps a deeply nested template entry point to root index and handles duplicate page names', () => {
    const home = 'https://frenify.com/work/envato/frenify/html/anor/1/index.html';
    const files = mapHtmlPageFiles([home, home.replace('index.html', 'about.html'), home.replace('index.html', 'blog.html'), 'https://frenify.com/other/about.html', home.replace('index.html', 'about.html?version=2')], home);
    expect(files.map(file => file.path)).toEqual(['index.html', 'pages/about.html', 'pages/blog.html', 'pages/about-2.html', 'pages/about-3.html']);
    expect(mapHtmlPageFiles([home], home)[0].cssPath).toBe('css/custom.css');
    expect(files.every(file => !file.path.includes('work/envato'))).toBe(true);
  });
  it('exports selected nested pages with relative assets and CDN-only Tailwind without build tooling', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockImplementation(async (conversionId, _assets, inline) => {
      await conversionStorage.writeFileSafe(conversionId, 'public/images/logo.png', Buffer.from([137, 80, 78, 71]));
      await conversionStorage.writeFileSafe(conversionId, 'public/css/main.css', '.hero{background:url(/images/logo.png)}');
      return { downloadedAssets: [
        { originalUrl: 'https://site.test/logo.png', localPath: 'public/images/logo.png', publicUrl: '/images/logo.png', mimeType: 'image/png', sizeBytes: 4, hash: 'logo', isSvg: false, isFont: false, isStylesheet: false, isImage: true },
        { originalUrl: 'https://site.test/styles/main.css', localPath: 'public/css/main.css', publicUrl: '/css/main.css', mimeType: 'text/css', sizeBytes: 50, hash: 'css', isSvg: false, isFont: false, isStylesheet: true, isImage: false },
      ], missingAssets: [], consolidatedCss: (inline || []).map((item) => typeof item === 'string' ? item : item.css).join('\n') + '\n.hero{background-image:url(/images/logo.png)}' };
    });
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages, options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', cloneMode: 'full' }) });
    expect(result.pageFiles.map((page) => page.path)).toEqual(['index.html', 'pages/post.html']);
    const home = await conversionStorage.readFileSafe(id, 'index.html');
    const nested = await conversionStorage.readFileSafe(id, 'pages/post.html');
    expect(home).toContain('pages/post.html#section');
    expect(home).toContain('lang="fr"');
    expect(home).toContain('name="description"');
    expect(nested).toContain('../index.html');
    expect(nested).toContain('../assets/images/logo/logo.png');
    expect(result.pageFiles.every(page => page.cssPath === '')).toBe(true);
    await expectCdnExport(id, home!);
    await expectCdnExport(id, nested!);
    expect(cheerio.load(home!)('div').hasClass('flex')).toBe(true);
    expect(nested).not.toContain('../css/pages/post.css');
    expect(nested).toContain('<details>');
    const css = await conversionStorage.readFileSafe(id, 'css/custom.css');
    const compiled = await readTailwindPreviewCss(id);
    expect(compiled).toContain('display: flex');
    expect(css).toBeNull();
    expect(compiled).toContain('font-family: Custom');
    expect(compiled).toContain('assets/images/logo/logo.png');
    expect(cheerio.load(home!)('[style], style')).toHaveLength(0);
    expect(await conversionStorage.readFileSafe(id, 'css/source/main.css')).toBeNull();
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'css/source'))).rejects.toThrow();
    expect(await conversionStorage.readFileSafe(id, 'css/components.css')).toBeNull();
    expect(home).not.toContain('css/components.css');
    expect(await conversionStorage.readFileSafe(id, 'js/main.js')).toBeNull();
    expect(await conversionStorage.readFileSafe(id, 'js/utils/dom.js')).toBeNull();
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'js'))).rejects.toThrow();
    expect(await conversionStorage.readFileSafe(id, 'README.md')).toBeNull();
    expect(result.conversionStats.declarationsConverted).toBeGreaterThan(0);
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'public'))).rejects.toThrow();
    expect(await conversionStorage.readFileSafe(id, 'package.json')).toBeNull();
    expect(result.warnings.join(' ')).toContain('internet access');
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'node_modules'))).rejects.toThrow();
  });
  it('integrates SVG extraction before Tailwind migration and reuses icons across exported pages', async () => {
    const id = makeId();
    const icon = '<svg width="24" height="24" viewBox="0 0 24 24"><!-- optimize --><path fill="#123456" d="M0 0L24 0L24 24Z"/></svg>';
    const dynamic = '<svg width="24" height="24" fill="currentColor"><path d="M0 0L24 24"/></svg>';
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '' });
    const result = await exportStandaloneHtml({
      conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test',
      pages: ['https://site.test/', 'https://site.test/about'].map(url => ({ url, rawData: { html: '<html><head></head><body><div class="layout" style="display:flex">' + icon + dynamic + '</div></body></html>' } })),
      options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', cloneMode: 'full' }),
    });
    expect(result.svgStats).toMatchObject({ detected: 4, extracted: 4, keptInline: 0, reused: 2, assetsCreated: 2 });
    const home = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    const nested = (await conversionStorage.readFileSafe(id, 'pages/about.html'))!;
    const assetPath = home.match(/src="(assets\/svgs\/svg-[a-f0-9]+\.svg)"/)![1];
    expect(nested).toContain('src="../' + assetPath + '"');
    expect(home).not.toContain('<svg');
    expect(nested).not.toContain('<svg');
    expect(await readTailwindPreviewCss(id)).toContain('display: flex');
    expect(await conversionStorage.readFileSafe(id, assetPath)).not.toContain('<!--');
    const tree = await conversionStorage.buildFileTree(id);
    const countFiles = (node: typeof tree): number => node.type === 'file' ? 1 : (node.children || []).reduce((sum, child) => sum + countFiles(child), 0);
    expect(result.totalFilesGenerated).toBe(countFiles(tree));
  });
  it('removes legacy framework utility names without activating accidental CDN styling', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '.container{width:240px}.flex{display:block}.p-4{padding:20px}' });
    await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({}), pages: [{ url: 'https://site.test/', rawData: { html: '<div class="container flex p-4">Content</div>' } }] });
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    const $ = cheerio.load(html);
    expect($('div').hasClass('container')).toBe(false);
    expect($('div').hasClass('flex')).toBe(false);
    expect($('div').hasClass('p-4')).toBe(false);
    expect($('div').hasClass('block')).toBe(true);
    expect($('div').hasClass('p-5')).toBe(true);
    expect($('div').attr('class')).not.toContain('source-');
  });
  it('keeps CSS-dependent SVG inline and converts its paint without embedded source CSS assets', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: 'svg path{fill:red}svg{width:24px}' });
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }), pages: [{ url: 'https://site.test/', rawData: { html: '<svg viewBox="0 0 24 24"><path style="opacity:.5" d="M0 0L24 24"/></svg>' } }] });
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(cheerio.load(html)('svg path')).toHaveLength(1);
    expect(cheerio.load(html)('[style], style')).toHaveLength(0);
    expect(result.svgStats.keptInline).toBe(1);
    expect(result.svgStats.assetsCreated).toBe(0);
    expect(await readTailwindPreviewCss(id)).toContain('fill: red');
    await expectCdnExport(id, html);
  });
  it('keeps original-site anchors local and disables pages not included in the export', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '' });
    await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', cloneMode: 'full' }), pages: [
      { url: 'https://site.test/', rawData: { html: '<a href="http://www.site.test/about?utm_source=nav#team" target="_blank">About</a><a href="/missing" target="_top">Missing</a><a href="https://other.test/">External</a><a href="mailto:test@site.test">Email</a>' } },
      { url: 'https://site.test/about/', rawData: { html: '<a href="https://site.test/index.html">Home</a>' } },
    ] });
    const home = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(home).toContain('href="pages/about.html?utm_source=nav#team"');
    expect(home).not.toContain('target="_blank"');
    expect(home).not.toContain('href="https://site.test/missing"');
    expect(home).toContain('data-unavailable-route="true"');
    expect(home).toContain('inert=""');
    expect(home).not.toContain('href="https://other.test/"');
    expect(home).not.toContain('href="mailto:test@site.test"');
    expect(await conversionStorage.readFileSafe(id, 'pages/about.html')).toContain('href="../index.html"');
  });
  it('exports no remote hrefs in anchors, image maps, SVG links or metadata', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '' });
    await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }), pages: [{ url: 'https://site.test/', rawData: { html: `
      <head><link rel="canonical" href="https://site.test/"><link rel="alternate" href="https://other.test/feed"></head>
      <body><a href="//other.test/path" target="_blank">External</a><a href="tel:123">Phone</a>
      <a href="#section" target="_top">Section</a><a href="/">Home</a>
      <map><area href="https://other.test/map"></map>
      <svg><a xlink:href="https://other.test/svg"><text>SVG link</text></a></svg></body>` } }] });
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(html).not.toMatch(/(?:href|xlink:href)="(?:[a-z][a-z\d+.-]*:|\/\/)/i);
    expect(html).not.toContain('target=');
    expect(html).toContain('href="#section"');
    expect(html).toContain('href="index.html"');
    expect(html).toContain('aria-disabled="true"');
  });
  it('does not package randomly named source CSS while retaining consolidated rules and assets', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockImplementation(async conversionId => {
      const downloadedAssets = [];
      for (let index = 0; index < 30; index++) {
        const filename = `chunk-${index.toString(16).padStart(8, '0')}.css`;
        await conversionStorage.writeFileSafe(conversionId, 'public/css/' + filename, '.original{color:red}');
        downloadedAssets.push({ originalUrl: 'https://site.test/' + filename, localPath: 'public/css/' + filename, publicUrl: '/css/' + filename, mimeType: 'text/css', sizeBytes: 20, hash: filename, isStylesheet: true, isSvg: false, isFont: false, isImage: false });
      }
      return { downloadedAssets, missingAssets: [], consolidatedCss: '.original{display:flex;background:linear-gradient(red,blue)}' };
    });
    await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }), pages: [{ url: 'https://site.test/', rawData: { html: '<link rel="stylesheet" href="/main.css"><link rel="preload" as="style" href="/chunk-00000000.css"><div class="original">Styled</div>' } }] });
    const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(html).not.toContain('chunk-');
    expect(html).not.toContain('css/source');
    await expectCdnExport(id, html);
    expect(cheerio.load(html)('div').hasClass('flex')).toBe(true);
    expect(await readTailwindPreviewCss(id)).toContain('display: flex');
    expect(await readTailwindPreviewCss(id)).toContain('linear-gradient');
  });
  it('keeps layouts inside every page without generating component fragments', async () => {
    const id = makeId();
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '' });
    const layout = '<header>Header<nav>Navigation</nav></header><aside>Sidebar</aside><footer>Footer</footer>';
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', cloneMode: 'full' }), pages: ['https://site.test/', 'https://site.test/about/'].map(url => ({ url, rawData: { html: layout } })) });
    for (const page of result.pageFiles) {
      const html = (await conversionStorage.readFileSafe(id, page.path))!;
      const $ = cheerio.load(html);
      expect($('header').text().replace(/\s+/g, '')).toBe('HeaderNavigation');
      expect($('header nav').text()).toBe('Navigation');
      expect($('aside').text()).toBe('Sidebar');
      expect($('footer').text()).toBe('Footer');
      await expectCdnExport(id, html);
    }
    await expect(fs.access(path.join(conversionStorage.getProjectDir(id), 'components'))).rejects.toThrow();
    expect(await conversionStorage.readFileSafe(id, 'tailwind.config.cjs')).toBeNull();
    expect(await conversionStorage.readFileSafe(id, 'README.md')).toBeNull();
    const tree = await conversionStorage.buildFileTree(id);
    const countFiles = (node: typeof tree): number => node.type === 'file' ? 1 : (node.children || []).reduce((sum, child) => sum + countFiles(child), 0);
    expect(result.totalFilesGenerated).toBe(countFiles(tree));
  });
  it('respects single selection and fails empty or unmatched snapshots', async () => {
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: ['https://site.test/logo.png'], consolidatedCss: '.hero{display:flex}' });
    const run = (selected: typeof pages, options = {}) => exportStandaloneHtml({ conversionId: makeId(), jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: selected, options: HtmlConversionOptionsSchema.parse(options) });
    const result = await run(pages, { cssStrategy: 'tailwind', pages: [pages[1].url] });
    expect(result.pageFiles).toHaveLength(1);
    expect(result.pageFiles[0].url).toBe(pages[1].url);
    expect(result.warnings.join(' ')).toContain('Missing asset');
    await expect(run([])).rejects.toThrow('No captured');
    await expect(run([{ url: pages[0].url, rawData: { html: ' ' } }])).rejects.toThrow('empty HTML');
    await expect(run(pages, { pages: ['https://site.test/missing'] })).rejects.toThrow('missing');
    await expect(run(pages, { pages: pages.map((page) => page.url) })).rejects.toThrow('exactly one');
  });
  it('fails visibly when all source stylesheets are missing instead of shipping default-only Tailwind', async () => {
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: ['https://site.test/main.css (HTTP 403)'], consolidatedCss: '' });
    await expect(exportStandaloneHtml({ conversionId: makeId(), jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<html><head><link rel="stylesheet" href="/main.css"></head><body class="hero">Content</body></html>' } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }) })).rejects.toThrow('required source stylesheet could not be loaded');
  });
  it('rejects missing main stylesheets even when unrelated inline CSS was recovered', async () => {
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: ['https://site.test/css.php?css=app (HTTP 403)'], consolidatedCss: '.search{display:block}' });
    await expect(exportStandaloneHtml({ conversionId: makeId(), jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<link rel="stylesheet" href="/css.php?css=app"><style>.search{display:block}</style><main>Content</main>' } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }) })).rejects.toThrow('required source stylesheet');
  });
  it('rejects old snapshots with missing CSS-in-JS rules instead of exporting an unstyled page', async () => {
    await expect(exportStandaloneHtml({ conversionId: makeId(), jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<html><head><style data-styled="active"></style></head><body class="sc-missing">Missing runtime styles</body></html>' } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }) })).rejects.toThrow('Re-scrape this URL with PLAYWRIGHT');
  });

  it('omits unclosable popups and notices while preserving inline newsletter and legal content', () => {
    const warnings: string[] = [];
    const html = sanitizeStandaloneHtml(`<body class="modal-open theme" style="overflow:hidden">
      <main><h1>Page content</h1><section class="newsletter"><h2>Newsletter signup</h2></section>
      <article id="cookie-policy">Ordinary privacy article</article></main>
      <dialog open>Offer dialog<button>Close</button></dialog>
      <div role="alertdialog">Consent dialog</div><div class="newsletter-popup">Signup popup</div>
      <div id="onetrust-banner-sdk">Cookie banner</div><div class="modal-backdrop">Backdrop</div>
      <div data-captured-transient-ui="true">Hashed notice</div><div class="dmca-notice">DMCA popup</div>
      <footer>Legal footer</footer></body>`, warnings);
    expect(html).not.toMatch(/Offer dialog|Consent dialog|Signup popup|Cookie banner|Backdrop|Hashed notice|DMCA popup/);
    expect(html).toContain('Page content');
    expect(html).toContain('Newsletter signup');
    expect(html).toContain('Ordinary privacy article');
    expect(html).toContain('Legal footer');
    expect(html).not.toContain('modal-open');
    expect(html).toContain('overflow:auto!important');
    expect(warnings.some(warning => warning.includes('omitted'))).toBe(true);
  });
  it('removes fixed privacy-choice overlays with captured visible paint and emits a CSS guard', () => {
    const html = sanitizeStandaloneHtml('<main><p>Your Privacy choices explained</p><a href="#privacy">Privacy</a></main><div class="hashed" style="position:fixed;opacity:1!important;visibility:visible!important;transform:none!important"><h2>Your Privacy choices</h2><button>Save choices</button></div>', [], true);
    expect(html).not.toContain('class="hashed"');
    expect(html).toContain('Your Privacy choices explained');
    expect(html).toContain('data-static-overlay-guard');
    expect(html).toContain('display:none!important');
    expect(html).toContain('pointer-events:none!important');
    expect((sanitizeStandaloneHtml(html, []).match(/<style data-static-overlay-guard/g) || []).length).toBe(1);
  });
  it('strips source scripts, embedded documents, unsafe handlers and backend forms', () => {
    const warnings: string[] = [];
    const html = sanitizeStandaloneHtml('<html><head><base href="https://evil.test"><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><script type="application/ld+json">{}</script></head><body onload="evil()"><iframe srcdoc="evil"></iframe><svg><a xlink:href="javascript:evil()">x</a></svg><a href="java\nscript:evil()" onclick="evil()">x</a><form action="/checkout"><button formaction="https://evil.test">Pay</button></form><p style="color:red;behavior:url(evil.htc);width:expression(evil())">safe</p></body></html>', warnings);
    expect(html).not.toMatch(/<script|<iframe|onload=|onclick=|action=|javascript:|expression\(|behavior:/i);
    expect(html).toContain('<form inert="">');
    expect(warnings.length).toBeGreaterThan(0);
  });
  it('downloads nested stylesheet imports, fonts and root-relative CSS images using the actual downloader', async () => {
    const id = makeId();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
      const url = String(request);
      if (url.endsWith('/styles/main.css')) return new Response('@import "./fonts/type.css"; .hero{background-image:url(/images/bg.png);display:flex}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('/styles/fonts/type.css')) return new Response('@font-face{font-family:Custom;src:url(../../files/custom.woff2) format("woff2")}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('/files/custom.woff2')) return new Response('FONT', { headers: { 'content-type': 'font/woff2' } });
      if (url.endsWith('/images/bg.png')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
      return new Response('Missing', { status: 404 });
    });
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test',
      pages: [{ url: 'https://site.test/blog/post/', rawData: { html: '<html><head><link rel="stylesheet" href="/styles/main.css"></head><body class="custom"><div class="hero">Test</div></body></html>' } }],
      options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }) });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://site.test/images/bg.png');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://site.test/files/custom.woff2');
    expect(result.missingAssets).toEqual([]);
    expect(result.pageFiles[0].cssPath).toBe('');
    const css = await readTailwindPreviewCss(id);
    expect(css).not.toContain('@font-face');
    expect(result.warnings.join(' ')).toContain('@font-face');
    expect(css).toContain('assets/images/');
    expect(css).not.toContain('@import'); expect(css).not.toContain('https://site.test/');
  });
  it('resolves the source cascade while preserving imported hover rules and link media behavior', async () => {
    const id = makeId();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async request => {
      const url = String(request);
      if (url.endsWith('bootstrap.css')) return new Response('@import "./imported.css"; .card{padding:20px}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('imported.css')) return new Response('.card:hover{color:blue}', { headers: { 'content-type': 'text/css' } });
      return new Response('', { status: 404 });
    });
    const result = await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }), pages: [{ url: 'https://site.test/', rawData: { html: '<style>.card{padding:10px}</style><link rel="stylesheet" href="/bootstrap.css" media="(min-width:700px)"><style>.card{padding:30px}</style><div class="card" style="display:flex">Test</div>' } }] });
    const output = (await conversionStorage.readFileSafe(id, 'index.html'))!;
    expect(cheerio.load(output)('[style], style')).toHaveLength(0);
    expect(output).not.toContain('bootstrap.css');
    await expectCdnExport(id, output);
    const css = await readTailwindPreviewCss(id);
    expect(cheerio.load(output)('div').hasClass('flex')).toBe(true);
    expect(css).toContain('padding: 30px');
    expect(css).toMatch(/color:\s*(?:blue|rgb\(0 0 255\b)/);
    expect(result.warnings.join(' ')).not.toContain('Unsupported');
    if (!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')) return;
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      const $ = cheerio.load(output);
      $('script').remove();
      $('head').append($('<style>').text(css));
      for (const width of [500, 1000]) {
        await page.setViewportSize({ width, height: 700 });
        await page.setContent($.html());
        await page.mouse.move(0, 0);
        const card = page.locator('div.flex');
        expect(await card.evaluate(element => getComputedStyle(element).padding)).toBe('30px');
        expect(await card.evaluate(element => getComputedStyle(element).display)).toBe('flex');
        await card.hover();
        expect(await card.evaluate(element => getComputedStyle(element).color)).toBe(width >= 700 ? 'rgb(0, 0, 255)' : 'rgb(0, 0, 0)');
      }
    } finally { await browser.close(); }
  });
  it('rejects path traversal and unsafe conversion IDs', async () => {
    const id = makeId();
    await conversionStorage.setupConversionWorkspace(id);
    await expect(conversionStorage.readFileSafe(id, '../private.txt')).rejects.toThrow('traversal');
    await expect(conversionStorage.writeFileSafe(id, '../../escape.html', '')).rejects.toThrow('traversal');
    expect(() => conversionStorage.getProjectDir('../escape')).toThrow('Invalid conversion');
  });
});
