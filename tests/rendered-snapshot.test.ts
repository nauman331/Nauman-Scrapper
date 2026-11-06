import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { waitForRenderedContent } from '../src/crawlers/render-readiness.js';

const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
const launchBrowser = () => chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';
import { execFileSync } from 'node:child_process';

describe('Snapshot paint migration', () => {
  it('keeps captured important paint inline above important source selectors', () => {
    const result = convertDocumentsToTailwind([{ id: 'test', html: '<section id="copy" data-captured-animation-state style="opacity:1!important;visibility:visible!important;transform:none!important">Privacy copy</section>' }], '#copy{opacity:0!important;visibility:hidden!important}');
    expect(result.documents[0].html).toContain('opacity:1!important');
    expect(result.documents[0].html).toContain('visibility:visible!important');
    expect(result.documents[0].html).toContain('transform:none!important');
  });
});

// Actual Chromium integration when installed; deployment-independent tests run separately.
describe.skipIf(!hasBrowser)('CSSOM snapshot and styled HTML export', () => {
  it('runs readiness in the actual tsx worker runtime without missing serialization helpers', () => {
    const script = `import { chromium } from 'playwright'; import { waitForRenderedContent } from './src/crawlers/render-readiness.ts'; import { captureRenderedHtml } from './src/crawlers/rendered-snapshot.ts';
      (async () => { const browser = await chromium.launch({headless:true${existsSync(chromium.executablePath()) ? '' : ",channel:'chrome'"}});
      try { const page = await browser.newPage(); await page.setContent('<h1>Runtime text</h1>');
      await waitForRenderedContent(page, 500); const snapshot = await captureRenderedHtml(page); if (!snapshot.includes('Runtime text')) throw new Error('Missing captured content'); console.log('READINESS_OK'); } finally { await browser.close(); } })();`;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--eval', script], { encoding: 'utf8', timeout: 15000 });
    expect(output).toContain('READINESS_OK');
  }, 20000);
  it('waits for delayed text and scroll reveals and freezes animation end state without revealing dialogs', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent('<style>@keyframes reveal{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}.reveal{animation:reveal 0.5s forwards}.pending{opacity:0}.spacer{height:1600px}</style><h1 class="reveal">Animated heading</h1><p id="delayed"></p><div class="spacer"></div><p id="scrolled" class="pending">Scroll text</p><dialog>Do not reveal</dialog><script>setTimeout(()=>document.querySelector("#delayed").textContent="Loaded later",700);const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){document.querySelector("#scrolled").className="reveal"}});observer.observe(document.querySelector("#scrolled"));</script>');
      await waitForRenderedContent(page, 5000);
      const html = await captureRenderedHtml(page);
      expect(html).toContain('Loaded later');
      expect(html).toContain('data-captured-animation-state');
      await page.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
      expect(await page.locator('h1').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      expect(await page.locator('#scrolled').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      expect(await page.locator('dialog').evaluate(element => getComputedStyle(element).display)).toBe('none');
    } finally { await browser.close(); }
  }, 15000);

  it('marks opaque fixed consent banners without marking inline newsletter sections', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent('<main><section id="inline">Newsletter subscription<button>Subscribe</button></section></main><div id="hashed" style="position:fixed;bottom:0">We use cookies<button>Accept</button></div>');
      const html = await captureRenderedHtml(page);
      await page.setContent(html);
      expect(await page.locator('#hashed').getAttribute('data-captured-transient-ui')).toBe('true');
      expect(await page.locator('#inline').getAttribute('data-captured-transient-ui')).toBeNull();
    } finally { await browser.close(); }
  }, 15000);

  it('captures text revealed after a long JS delay with no CSS animation metadata', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent('<style>.late{opacity:0;transform:translateY(30px)}.late.ready{opacity:1;transform:none}</style><h1 class="late">Delayed hero copy</h1><p id="late-insert"></p><script>setTimeout(()=>{document.querySelector("h1").classList.add("ready");document.querySelector("#late-insert").textContent="Delayed description"},3500)</script>');
      await waitForRenderedContent(page, 8000);
      const html = await captureRenderedHtml(page);
      expect(html).toContain('Delayed description');
      expect(html).toContain('data-captured-animation-state');
      // Simulate an export losing the JS runtime class: the captured visible
      // paint must still take precedence over the initial hidden CSS rule.
      await page.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace('late ready', 'late'));
      expect(await page.locator('h1').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      expect(await page.locator('h1').evaluate(element => getComputedStyle(element).transform)).toBe('none');
    } finally { await browser.close(); }
  }, 15000);

  it('waits inside each viewport for lazy text and preserves reversible ancestor reveals', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
      await page.setContent(`
        <style>body{margin:0}.spacer{height:700px}#section{height:160px;opacity:0;transform:translateY(20px)}
        #section.ready{opacity:1;transform:none}#private{display:none}</style>
        <h1>Hero</h1><div class="spacer"></div><section id="section"><p id="copy"></p></section>
        <div class="spacer"></div><div id="private" aria-hidden="true">Private menu</div>
        <script>
          let timer;
          const section = document.querySelector('#section');
          new IntersectionObserver(entries => {
            clearTimeout(timer);
            if (entries[0].isIntersecting) timer = setTimeout(() => {
              document.querySelector('#copy').textContent = 'Lazy section description';
              section.classList.add('ready');
            }, 1000);
            else section.classList.remove('ready');
          }).observe(section);
        </script>`);
      await waitForRenderedContent(page, 7000);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      const html = await captureRenderedHtml(page);
      expect(html).toContain('Lazy section description');
      await page.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
      expect(await page.locator('#section').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      expect(await page.locator('#section').evaluate(element => getComputedStyle(element).transform)).toBe('none');
      expect(await page.locator('#private').evaluate(element => getComputedStyle(element).display)).toBe('none');
    } finally { await browser.close(); }
  }, 15000);

  it('loads text inside overflow scroll roots and restores their scroll position', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <style>#root{height:300px;overflow-y:auto}.spacer{height:400px}#copy{height:80px;opacity:0}</style>
        <div id="root"><div class="spacer"></div><p id="copy" data-scroll-reveal></p><div class="spacer"></div></div>
        <script>
          const root = document.querySelector('#root');
          const copy = document.querySelector('#copy');
          new IntersectionObserver(entries => {
            if(entries[0].isIntersecting) setTimeout(() => {
              copy.textContent = 'Nested lazy copy'; copy.style.opacity = '1';
            }, 500);
            else copy.style.opacity = '0';
          }, {root}).observe(copy);
        </script>`);
      await waitForRenderedContent(page, 7000);
      expect(await page.locator('#root').evaluate(element => element.scrollTop)).toBe(0);
      const html = await captureRenderedHtml(page);
      expect(html).toContain('Nested lazy copy');
      await page.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
      expect(await page.locator('#copy').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    } finally { await browser.close(); }
  }, 15000);

  it('stops within its budget on continuously growing feeds', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent('<h1>Feed</h1><script>setInterval(()=>{const item=document.createElement("p");item.style.height="500px";item.textContent="Feed item";document.body.append(item)},100)</script>');
      const started = Date.now();
      await waitForRenderedContent(page, 1500);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(await page.evaluate(() => scrollY)).toBe(0);
    } finally { await browser.close(); }
  }, 10000);

  it('captures session-loaded external CSS in order, including imported asset bases and link media', async () => {
    const browser = await launchBrowser();
    const id = `external_cssom_test_${Date.now()}`;
    try {
      const page = await browser.newPage();
      await page.route('https://snapshot.test/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/styles/main.css') return route.fulfill({ contentType: 'text/css', body: '@import "nested/import.css"; .hero{display:flex;background-image:url(../images/hero.png)}' });
        if (pathname === '/styles/nested/import.css') return route.fulfill({ contentType: 'text/css', body: '.hero{color:rgb(12,34,56);background-image:url(icon.png)}' });
        if (pathname === '/print.css') return route.fulfill({ contentType: 'text/css', body: '.hero{display:none}' });
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/styles/main.css"><style>.hero{padding:12px}</style><link rel="stylesheet" href="/print.css" media="print"></head><body><div class="hero">Forum</div></body></html>' });
        return route.fulfill({ status: 404, body: '' });
      });
      await page.goto('https://snapshot.test/');
      const html = await captureRenderedHtml(page);
      const dom = cheerio.load(html);
      expect(dom('link[rel~="stylesheet"]')).toHaveLength(0);
      expect(dom('style[data-captured-stylesheet]')).toHaveLength(2);
      expect(dom('head style').map((_, element) => dom(element).attr('data-captured-stylesheet') || 'inline').get()).toEqual(['https://snapshot.test/styles/main.css', 'inline', 'https://snapshot.test/print.css']);
      expect(html).toContain('https://snapshot.test/styles/nested/icon.png');
      expect(html).toContain('https://snapshot.test/images/hero.png');
      expect(dom('style[media="print"]').text()).toContain('display: none');
      expect(html).not.toContain('@import');
      // The browser's session is no longer available when the snapshot is replayed.
      await page.unrouteAll();
      await page.route('**/*', route => route.abort());
      await page.setContent(html);
      expect(await page.locator('.hero').evaluate(element => getComputedStyle(element).display)).toBe('flex');
      expect(await page.locator('.hero').evaluate(element => getComputedStyle(element).padding)).toBe('12px');
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
      try {
        await exportStandaloneHtml({ conversionId: id, jobId: 'test', targetUrl: 'https://snapshot.test/', domain: 'snapshot.test', pages: [{ url: 'https://snapshot.test/', rawData: { html } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind' }) });
        expect(fetch.mock.calls.some(([url]) => /main\.css|import\.css|print\.css/.test(String(url)))).toBe(false);
        const output = (await conversionStorage.readFileSafe(id, 'index.html'))!;
        const preview: Record<string, string> = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8'));
        const dom = cheerio.load(output);
        dom('script').remove();
        dom('head').append(dom('<style>').text(preview['index.html']));
        await page.setContent(dom.html());
        expect(await page.locator('div.flex').evaluate(element => getComputedStyle(element).padding)).toBe('12px');
        expect(await page.locator('div.flex').evaluate(element => getComputedStyle(element).color)).toBe('rgb(12, 34, 56)');
      } finally { fetch.mockRestore(); }
    } finally { await browser.close(); await conversionStorage.deleteConversion(id); }
  });

  it('captures insertRule/adopted CSS and loads source styles plus Tailwind on home and child pages', async () => {
    const browser = await launchBrowser();
    const id = `cssom_test_${Date.now()}`;
    const downloader = vi.spyOn(assetDownloader, 'resolveAssets').mockImplementation(async (_id, _assets, inline) => ({ downloadedAssets: [], missingAssets: [], consolidatedCss: (inline || []).map(style => typeof style === 'string' ? style : style.css).join('\n') }));
    try {
      const page = await browser.newPage();
      await page.setContent('<html><head><style data-styled="active"></style></head><body><h1 class="styled-title">Styled page</h1><div class="layout flex items-center">Content</div></body></html>');
      await page.evaluate(() => {
        const sheet = document.querySelector('style')!.sheet!;
        sheet.insertRule('.styled-title { font-size: 48px; font-family: sans-serif; color: rgb(12, 34, 56); }');
        sheet.insertRule('.layout { padding: 24px; }');
        sheet.insertRule('.flex { display: flex; }');
        sheet.insertRule('.items-center { align-items: center; }');
        const adopted = new CSSStyleSheet(); adopted.replaceSync('body { background-color: rgb(240, 241, 242); }'); document.adoptedStyleSheets = [adopted];
      });
      expect(await page.content()).not.toContain('font-size: 48px');
      const html = await captureRenderedHtml(page);
      expect(html).toContain('font-size: 48px');
      expect(html).toContain('data-captured-adopted-styles');
      const result = await exportStandaloneHtml({ conversionId: id, jobId: 'test', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html } }, { url: 'https://site.test/about', rawData: { html } }], options: HtmlConversionOptionsSchema.parse({ cloneMode: 'full' }) });
      const preview: Record<string, string> = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8'));
      for (const file of result.pageFiles) {
        const document = await conversionStorage.readFileSafe(id, file.path);
        await page.route('https://preview.test/**', async route => {
          const pathname = new URL(route.request().url()).pathname.slice(1);
          const content = await conversionStorage.readFileSafe(id, pathname);
          const $ = cheerio.load(content || '');
          $('script').remove();
          $('head').append($('<style>').text(preview[pathname] || ''));
          await route.fulfill({ status: content === null ? 404 : 200, contentType: 'text/html', body: $.html() });
        });
        await page.goto('https://preview.test/' + file.path);
        expect(document).toMatch(/^<!doctype html>\n/);
        expect(document).toContain('https://cdn.tailwindcss.com/3.4.17');
        expect(document).not.toContain('css/output.css');
        expect(await page.locator('h1').evaluate(element => getComputedStyle(element).fontSize)).toBe('48px');
        expect(await page.locator('h1').evaluate(element => getComputedStyle(element).fontFamily)).toBe('sans-serif');
        expect(await page.locator('.flex').evaluate(element => getComputedStyle(element).display)).toBe('flex');
        expect(await page.locator('.items-center').evaluate(element => getComputedStyle(element).alignItems)).toBe('center');
        expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(240, 241, 242)');
        await page.unroute('https://preview.test/**');
      }
    } finally { downloader.mockRestore(); await browser.close(); await conversionStorage.deleteConversion(id); }
  }, 30000);
});
