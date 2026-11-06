import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { sanitizeStandaloneHtml } from '../src/generator/html-exporter.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';

// Explicit live-site verification; not part of deterministic CI.
const enabled = process.env.VERIFY_TAILWIND_LIVE === '1';
const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
describe('live CSS conversion', () => {
  it.skipIf(!enabled || !hasBrowser)('preserves Playful layered desktop and mobile styles in compiled Tailwind', async () => {
    const url = 'https://playful.app/';
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    const dom = cheerio.load(sanitizeStandaloneHtml(await response.text(), []));
    const sources = dom('style').toArray().map(element => dom(element).text());
    for (const element of dom('link[rel~="stylesheet"]').toArray()) {
      const response = await fetch(new URL(dom(element).attr('href')!, url));
      expect(response.ok).toBe(true);
      sources.push(await response.text());
    }
    dom('style, link[rel~="stylesheet"]').remove();
    const html = dom.html();
    const css = sources.join('\n');
    const result = convertDocumentsToTailwind([{ id: 'playful', html }], css, { strict: true });
    expect(result.warnings.some(warning => /layered selector|Unsupported @layer/.test(warning.message))).toBe(false);
    const compiled = (await postcss([tailwindcss({ content: [], safelist: result.utilities!, corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined })).css;
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort());
      const capture = () => page.evaluate(() => ['body', 'header', 'main', 'h1', 'h2', 'p'].map(selector => {
        const element = document.querySelector(selector);
        if (!element) return { selector };
        const style = getComputedStyle(element);
        return { selector, display: style.display, position: style.position, padding: style.padding, color: style.color, background: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, maxWidth: style.maxWidth, gap: style.gap };
      }));
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(html.replace('<head>', `<head><style>${css}</style>`));
        const source = await capture();
        await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
        expect(await capture()).toEqual(source);
      }
    } finally { await browser.close(); }
  }, 120000);
  it.skipIf(!enabled || !hasBrowser)('uses element utilities and preserves representative desktop/mobile layout', async () => {
    const url = 'https://www.nsolvers.com/';
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    const $ = cheerio.load(sanitizeStandaloneHtml(await response.text(), []));
    const sources: string[] = [];
    for (const element of $('link[rel="stylesheet"]').toArray()) {
      const href = new URL($(element).attr('href')!, url);
      // Custom webfonts cannot be compared without @font-face; use the same
      // declared system fallback on both versions and report that limitation.
      if (href.origin !== new URL(url).origin) continue;
      const css = await fetch(href);
      expect(css.ok).toBe(true);
      sources.push(await css.text());
    }
    $('link[rel="stylesheet"], style').remove();
    const html = $.html();
    const css = sources.join('\n');
    const result = convertDocumentsToTailwind([{ id: 'live-nsolvers', html }], css, { strict: true });
    expect(result.documents[0].html).not.toMatch(/data-tw-rules|tw-inline-specificity|@media_all/);
    const converted = cheerio.load(result.documents[0].html);
    expect(converted('html').attr('class') || '').not.toContain('_:root');
    expect(converted('[style], style')).toHaveLength(0);
    const compiled = (await postcss([tailwindcss({ content: [], safelist: result.utilities!, corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined })).css;
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      // No source scripts or remote network behavior while measuring styling.
      await page.route('**/*', route => route.abort());
      const capture = () => page.evaluate(() => ['body', 'header', 'nav', '#nav-menu', 'h1'].map(selector => {
        const element = document.querySelector(selector)!;
        const style = getComputedStyle(element);
        return { selector, display: style.display, position: style.position, padding: style.padding, color: style.color, background: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, maxWidth: style.maxWidth, gap: style.gap };
      }));
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(html.replace(/<head[^>]*>/i, match => `${match}<style>${css}</style>`));
        const source = await capture();
        await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
        expect(await capture()).toEqual(source);
      }
    } finally { await browser.close(); }
  }, 60000);
});
