import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import * as cheerio from 'cheerio';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';
import { zipPackager } from '../src/generator/packager/zip-packager.js';

const measure = (page: Page) => page.evaluate(() => ['body', 'h1', 'h2', 'p', 'input', 'nav'].map(selector => {
  const element = document.querySelector(selector)!;
  const style = getComputedStyle(element);
  return { selector, family: style.fontFamily, weight: style.fontWeight, size: style.fontSize, lineHeight: style.lineHeight, spacing: style.letterSpacing };
}));

describe.skipIf(process.env.VERIFY_NAVTOOLS_LIVE !== '1')('NavTools live font export', () => {
  it('generates a ZIP and renders the same typography with loaded local Inter', async () => {
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    const id = `navtools_fonts_${Date.now()}`;
    const artifactDir = conversionStorage.getConversionDir(id);
    const server = createServer(async (req, res) => {
      try {
        const file = decodeURIComponent(new URL(req.url || '/', 'http://local.test').pathname).replace(/^\/+/, '') || 'index.html';
        const content = await conversionStorage.readPreviewFileSafe(id, file);
        if (!content) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': /\.woff2$/.test(file) ? 'font/woff2' : /\.css$/.test(file) ? 'text/css' : /\.svg$/.test(file) ? 'image/svg+xml' : /\.png$/.test(file) ? 'image/png' : /\.webp$/.test(file) ? 'image/webp' : /\.jpe?g$/.test(file) ? 'image/jpeg' : 'text/html' });
        res.end(content);
      } catch { res.writeHead(404); res.end(); }
    });
    try {
      const source = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await source.goto('https://navtools.ai/', { waitUntil: 'networkidle', timeout: 60000 });
      await source.evaluate(() => document.fonts.ready);
      const html = await captureRenderedHtml(source);
      const result = await exportStandaloneHtml({ conversionId: id, jobId: 'navtools-live', targetUrl: 'https://navtools.ai/', domain: 'navtools.ai', pages: [{ url: 'https://navtools.ai/', rawData: { html } }], options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', projectName: 'navtools-ai-fonts' }), stage: (_stage, message) => process.stdout.write(message + '\n') });
      const preview = JSON.parse(await fs.readFile(path.join(artifactDir, 'tailwind-preview.json'), 'utf8')) as Record<string, string>;
      expect(preview['index.html']).toContain('@font-face');
      const fonts = (await conversionStorage.readFileSafe(id, 'assets/fonts/fonts.css'))!;
      expect(fonts).toContain('100 900');
      expect(fonts).toContain('font-family: "inter"');
      expect(fonts).not.toContain('https://');
      const zip = await zipPackager.packageProject(conversionStorage.getProjectDir(id), conversionStorage.getZipPath(id, 'navtools-ai-fonts'));
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server');
      const origin = `http://127.0.0.1:${address.port}`;
      const replay = await browser.newPage();
      // Verify the script-free dashboard rendering without any external font dependency.
      await replay.route('**/*', async route => {
        if (!route.request().url().startsWith(origin)) return route.abort();
        if (route.request().url() === origin + '/') {
          const dom = cheerio.load((await conversionStorage.readFileSafe(id, 'index.html'))!);
          dom('script, link[data-cloned-fonts]').remove();
          dom('head').append(dom('<style>').text(preview['index.html']));
          return route.fulfill({ contentType: 'text/html', body: dom.html() });
        }
        return route.continue();
      });
      const measurements = [];
      for (const width of [1440, 390]) {
        await source.setViewportSize({ width, height: 900 });
        await replay.setViewportSize({ width, height: 900 });
        await replay.goto(origin, { waitUntil: 'networkidle' });
        await replay.evaluate(() => document.fonts.ready);
        const expected = await measure(source), actual = await measure(replay);
        measurements.push({ width, expected, actual });
        expect(actual).toEqual(expected);
        const loaded = await replay.evaluate(() => [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family));
        expect(loaded).toContain('inter');
        if (width === 1440) {
          const heading = await replay.locator('h1').evaluate(element => { const style = getComputedStyle(element); return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, textWidth: (() => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().width; })(), font: style.fontFamily }; });
          const original = await source.locator('h1').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().width; });
          expect(Math.abs(heading.textWidth - original)).toBeLessThan(1);
          await source.screenshot({ path: path.join(artifactDir, 'reference.png') });
          await replay.screenshot({ path: path.join(artifactDir, 'clone.png') });
        }
      }
      await fs.writeFile(path.join(artifactDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
      process.stdout.write(`Verified NavTools project: ${conversionStorage.getProjectDir(id)}\nZIP: ${zip.zipPath}\n`);
      expect(result.missingAssets.filter(url => /font|woff/i.test(url))).toEqual([]);
    } finally {
      await browser.close();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 240000);
});
