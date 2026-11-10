import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { removeSnapshotLoaders } from '../src/generator/loader-cleanup.js';
import { sanitizeStandaloneHtml, exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { cleanupExactSnapshot } from '../src/generator/exact-cleanup.js';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';

// H&S intro is aria-hidden and exits solely through CSS animation, not DOM removal.
const fixture = `<html class="theme no-scroll" style="overflow:hidden"><head><style>
.fixed{position:fixed}.inset-0{inset:0}.opaque{position:fixed;inset:0;background:white;z-index:60}
main{min-height:1800px}video{width:100%;height:300px;object-fit:cover}
</style></head><body class="page-loading" style="position:fixed;touch-action:none">
<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-bg animate-intro"><img alt="" src="/brand/hs-real-estate-black.png"></div>
<div aria-hidden="true" class="fixed inset-0 z-30 opacity-0"></div>
<header>Navigation</header><main><section class="hero"><h1>Main property data</h1><video muted loop playsinline></video></section><p>Market data</p></main>
<footer>Contact</footer></body></html>`;
const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
const launch = () => chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });

describe('loader-free captured page exports', () => {
  it('removes H&S intro and its full-screen decorative backdrop from old saved snapshots', () => {
    for (const cleanup of [removeSnapshotLoaders, (html: string, warnings: string[]) => ({ html: sanitizeStandaloneHtml(html, warnings) }), cleanupExactSnapshot]) {
      const result = cleanup(fixture, []);
      const $ = cheerio.load(result.html);
      expect($('body > .fixed')).toHaveLength(0);
      expect($('.animate-intro')).toHaveLength(0);
      expect($('main h1').text()).toBe('Main property data');
      expect($('main video')).toHaveLength(1);
      expect($('header,footer')).toHaveLength(2);
      expect($('html').attr('class')).toBe('theme');
      expect($('body').attr('style')).not.toContain('position:fixed');
      expect($('body').attr('style')).toContain('overflow:auto!important');
    }
  });
  it('removes named and marked loaders, not loading content containers or genuine fixed UI', () => {
    const result = removeSnapshotLoaders(`<main class="loading"><h1>Keep data</h1><div class="preLoader_42">Please wait</div><span role="status" class="loading-spinner">Loading</span><div class="q9" data-captured-loader="true">Logo</div></main>
      <header class="fixed inset-0">Header</header><section class="fixed inset-0 hero"><video></video></section><div class="fixed inset-0"><button>Menu</button></div><article class="loader-guide">Loader documentation</article><p>Loading market data…</p>`, []);
    const $ = cheerio.load(result.html);
    expect(result.removed).toBe(3);
    expect($('main h1').text()).toBe('Keep data');
    expect($('header,section,article')).toHaveLength(3);
    expect($('button')).toHaveLength(1);
    expect($('p').text()).toBe('Loading market data…');
  });
  it('removes an opaque full-screen logo from legacy CSS-only snapshots', () => {
    const result = removeSnapshotLoaders(fixture.replace('class="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-bg animate-intro"', 'class="opaque"'), []);
    expect(cheerio.load(result.html)('.opaque')).toHaveLength(0);
    expect(result.html).toContain('Main property data');
  });
  it.skipIf(!hasBrowser)('removes opaque CSS-only fullscreen loaders during capture without touching hero media', async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.setContent(fixture.replace('class="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-bg animate-intro"', 'class="opaque"'));
      const html = await captureRenderedHtml(page);
      const $ = cheerio.load(html);
      expect($('.opaque')).toHaveLength(0);
      expect($('main video')).toHaveLength(1);
      expect($('h1').text()).toBe('Main property data');
    } finally { await browser.close(); }
  });
  it.skipIf(!hasBrowser)('Core CSS and strict Tailwind exports show main content immediately without source JS', async () => {
    const browser = await launch();
    try {
      for (const cssStrategy of ['core', 'tailwind'] as const) {
        const id = `loader_test_${cssStrategy}_${Date.now()}`;
        try {
          await exportStandaloneHtml({ conversionId: id, jobId: 'loader-test', targetUrl: 'https://hsproperty.ae/', domain: 'hsproperty.ae', pages: [{ url: 'https://hsproperty.ae/', rawData: { html: fixture } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy }) });
          const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
          expect(html).not.toContain('hs-real-estate-black.png');
          expect(html).not.toContain('animate-intro');
          const $ = cheerio.load(html); $('script,link').remove();
          const css = cssStrategy === 'core' ? await conversionStorage.readFileSafe(id, 'css/core.css') : JSON.parse(await (await import('node:fs/promises')).readFile(`${conversionStorage.getConversionDir(id)}/tailwind-preview.json`, 'utf8'))['index.html'];
          $('head').append($('<style>').text(css || ''));
          const page = await browser.newPage();
          await page.setContent($.html());
          expect(await page.locator('h1').isVisible()).toBe(true);
          expect(await page.evaluate(() => document.elementFromPoint(100, 100)?.closest('main') !== null)).toBe(true);
          expect(await page.locator('body').evaluate(element => getComputedStyle(element).position)).not.toBe('fixed');
          await page.close();
        } finally { await conversionStorage.deleteConversion(id); }
      }
    } finally { await browser.close(); }
  }, 30000);
});
