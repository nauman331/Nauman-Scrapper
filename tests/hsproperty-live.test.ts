import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import * as cheerio from 'cheerio';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { waitForRenderedContent } from '../src/crawlers/render-readiness.js';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';

// Opt-in: downloads the real homepage, including both full video files.
// VERIFY_HSPROPERTY_LIVE=1 npx vitest run tests/hsproperty-live.test.ts
// HSPROPERTY_CSS_STRATEGY=tailwind verifies the strict Tailwind path instead.
const enabled = process.env.VERIFY_HSPROPERTY_LIVE === '1';
const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
const selectors = ['section[aria-label="H&S Real Estate in Dubai"]', 'video', 'h1', '#market-preview-heading', 'svg[aria-label^="Five-year"]', '[aria-labelledby="top-performers-heading"] article', 'svg[aria-label="AED"]', '[class*="_bar"]'];
const measure = (page: Page) => page.evaluate(selectors => selectors.map(selector => {
  const element = document.querySelector(selector);
  if (!element) return { selector, missing: true };
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return { selector, width: rect.width, height: rect.height, font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor, position: style.position, objectFit: style.objectFit, objectPosition: style.objectPosition, display: style.display, verticalAlign: style.verticalAlign };
}), selectors);

describe.skipIf(!enabled || !hasBrowser)('H&S homepage live scrape', () => {
  it('exports local responsive videos, source fonts, currency artwork and unmodified charts', async () => {
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    const id = `hsproperty_regression_${Date.now()}`;
    const strategy = process.env.HSPROPERTY_CSS_STRATEGY === 'tailwind' ? 'tailwind' : 'core';
    const artifactDir = conversionStorage.getConversionDir(id);
    await fs.mkdir(artifactDir, { recursive: true });
    const server = createServer(async (req, res) => {
      try {
        const filename = decodeURIComponent(new URL(req.url || '/', 'http://local.test').pathname).replace(/^\/+/, '') || 'index.html';
        const content = await conversionStorage.readPreviewFileSafe(id, filename);
        if (content === null) { res.writeHead(404); res.end(); return; }
        const mime = /\.css$/.test(filename) ? 'text/css' : /\.mp4$/.test(filename) ? 'video/mp4' : /\.woff2?$/.test(filename) ? 'font/woff2' : /\.svg$/.test(filename) ? 'image/svg+xml' : /\.png$/.test(filename) ? 'image/png' : /\.webp$/.test(filename) ? 'image/webp' : /\.jpe?g$/.test(filename) ? 'image/jpeg' : 'text/html';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length }); res.end(content);
      } catch { res.writeHead(404); res.end(); }
    });
    try {
      const source = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await source.goto('https://hsproperty.ae/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForRenderedContent(source, 30000);
      await source.locator('svg[aria-label^="Five-year"]').waitFor({ state: 'attached', timeout: 15000 });
      const html = await captureRenderedHtml(source);
      await fs.writeFile(path.join(artifactDir, 'source.html'), html);
      const sourceDom = cheerio.load(html);
      expect(sourceDom('.animate-intro,[data-captured-loader="true"]')).toHaveLength(0);
      const sources = sourceDom('video source').toArray().map(element => ({ src: sourceDom(element).attr('src')!, media: sourceDom(element).attr('media'), type: sourceDom(element).attr('type') }));
      expect(sources).toHaveLength(2);
      expect(sources[0].media).toBe('(max-width: 767px)');
      expect(sources[1].media).toBeUndefined();
      const awardRows = sourceDom('figure table tbody tr').toArray().map(element => sourceDom(element).text());
      expect(awardRows).toHaveLength(10);
      expect(sourceDom('[class*="_bar"]')).toHaveLength(10);
      const sourceChart = sourceDom('svg[aria-label^="Five-year"]').html();
      expect(sourceChart).toContain('stroke-dasharray');
      const priceSection = sourceDom('[aria-labelledby="market-preview-heading"]').text();
      expect(priceSection).not.toContain('Loading');
      const performers = sourceDom('[aria-labelledby="top-performers-heading"] article');
      expect(performers).toHaveLength(6);
      const currencySvgs = sourceDom('svg[aria-label="AED"]');
      expect(currencySvgs.length, 'Price currency artwork must be present').toBeGreaterThan(0);
      await fs.writeFile(path.join(artifactDir, 'currency-inspection.json'), JSON.stringify(currencySvgs.toArray().map(element => sourceDom(element).toString()), null, 2));
      const result = await exportStandaloneHtml({ conversionId: id, jobId: 'live-regression', targetUrl: 'https://hsproperty.ae/', domain: 'hsproperty.ae', pages: [{ url: 'https://hsproperty.ae/', rawData: { html } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: strategy, downloadAssets: true }), stage: (_stage, message) => process.stdout.write(message + '\n') });
      await fs.writeFile(path.join(artifactDir, 'export-result.json'), JSON.stringify(result, null, 2));
      const output = cheerio.load((await conversionStorage.readFileSafe(id, 'index.html'))!);
      expect(output('video')).toHaveLength(sourceDom('video').length);
      expect(output('video source').toArray().map(element => ({ media: output(element).attr('media'), type: output(element).attr('type') }))).toEqual(sources.map(({ media, type }) => ({ media, type })));
      for (const element of output('video source,video[src],video[poster]').toArray()) {
        for (const attr of ['src', 'poster']) {
          const value = output(element).attr(attr);
          if (!value) continue;
          expect(value).toMatch(/^assets\//);
          expect((await fs.stat(path.join(conversionStorage.getProjectDir(id), value))).size).toBeGreaterThan(0);
        }
      }
      // Core CSS deliberately retains SVG structure; strict Tailwind may extract SVGs.
      if (strategy === 'core') {
        expect(output('svg[aria-label^="Five-year"]').html()).toBe(sourceChart);
        expect(output('figure table tbody tr').toArray().map(element => output(element).text())).toEqual(awardRows);
        expect(output('[class*="_bar"]')).toHaveLength(10);
        expect(output('[aria-labelledby="top-performers-heading"] article')).toHaveLength(6);
        expect(output('svg[aria-label="AED"]').toArray().map(element => output(element).html())).toEqual(currencySvgs.toArray().map(element => sourceDom(element).html()));
        expect(output('svg[aria-label="AED"] path').eq(1).attr('d')).toBe('M3 9.6h17.6M3 14.4h17.6');
      }
      const css = strategy === 'core' ? (await conversionStorage.readFileSafe(id, 'css/core.css'))! : '';
      expect(css, 'Faithful fonts require retained local @font-face definitions').toContain('@font-face');
      expect(css).toMatch(/assets\/fonts\//);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      const localOrigin = `http://127.0.0.1:${address.port}`;
      const replay = await browser.newPage();
      const externalRequests: string[] = [];
      await replay.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(localOrigin) || url.startsWith('data:')) return route.continue();
        externalRequests.push(url); return route.abort();
      });
      const measurements = [];
      for (const width of [1440, 390, 767, 768]) {
        await source.setViewportSize({ width, height: 900 });
        await source.evaluate(() => document.querySelector('video')?.load());
        await replay.setViewportSize({ width, height: 900 });
        await replay.goto(localOrigin, { waitUntil: 'load', timeout: 60000 });
        await replay.evaluate(() => document.fonts.ready);
        expect(await replay.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('main') !== null), 'The hero must not be covered by a stuck intro loader').toBe(true);
        await expect.poll(() => replay.locator('video').evaluate(v => v.readyState), { timeout: 60000 }).toBeGreaterThanOrEqual(2);
        const video = await replay.locator('video').evaluate(v => ({ src: v.currentSrc, muted: v.muted, loop: v.loop, playsInline: v.playsInline, fit: getComputedStyle(v).objectFit, currentTime: v.currentTime }));
        expect(video.src).toContain(width <= 767 ? '720.mp4' : '1080.mp4');
        expect(video.muted && video.loop && video.playsInline).toBe(true);
        expect(video.fit).toBe('cover');
        await expect.poll(() => replay.locator('video').evaluate(v => v.currentTime), { timeout: 15000 }).toBeGreaterThan(video.currentTime);
        const expected = await measure(source);
        const actual = await measure(replay);
        measurements.push({ width, expected, actual });
        await fs.writeFile(path.join(artifactDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
        expect(actual).toEqual(expected);
      }
      expect(externalRequests).toEqual([]);
      process.stdout.write(`H&S verified artifact: ${artifactDir}\n`);
    } finally {
      await browser.close();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      // Keep the local exported project and diagnostic artifacts for inspection.
    }
  }, 900000);
});
