import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import * as cheerio from 'cheerio';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';

// Reference: https://www.portfoliobox.com/dist/css/landing-page.2b88224c.css
const referenceCss = `body{background:#160f24;color:white;font-family:Arial} .landing .hero .hero-headline .hero-title{font-family:Inter,sans-serif;font-size:56px;font-weight:700;color:#fff;line-height:1.1}
.landing .hero .hero-headline .hero-highlight{display:block;background:linear-gradient(270deg,#8b5cf6 0,#a78bfa 50%,#c4b5fd 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 30px rgba(139,92,246,.5))}
.landing .hero .hero-subline .quote-result{font-style:italic;background:linear-gradient(270deg,#8b5cf6 0,#a78bfa 50%,#c4b5fd 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
@media(max-width:600px){.landing .hero .hero-headline .hero-title{font-size:36px}}`;
const referenceHtml = '<main class="landing"><section class="hero"><div class="hero-headline"><h1 class="hero-title">The portfolio website builder <span class="hero-highlight">your work deserves</span></h1></div><p class="hero-subline">From I need a site to <span class="quote-result">this is exactly what I wanted.</span></p></section></main>';
const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
const compile = async (utilities: string[]) => (await postcss([tailwindcss({ content: [], safelist: utilities, corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined })).css;

describe('Portfoliobox gradient text regression', () => {
  it.skipIf(!hasBrowser)('preserves text clipping instead of painting gradient rectangles on desktop and mobile', async () => {
    const result = convertDocumentsToTailwind([{ id: 'po-portfoliobox', html: referenceHtml }], referenceCss, { strict: true });
    const compiled = await compile(result.utilities!);
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      const capture = () => page.locator('.hero-highlight, .quote-result').evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        return { clip: style.backgroundClip, webkitClip: style.getPropertyValue('-webkit-background-clip'), fill: style.getPropertyValue('-webkit-text-fill-color'), image: style.backgroundImage, color: style.color, display: style.display, fontSize: style.fontSize, filter: style.filter };
      }));
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await page.setContent(`<style>${referenceCss}</style>${referenceHtml}`);
        const expected = await capture();
        expect(expected.every(style => style.clip === 'text')).toBe(true);
        await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
        expect(await capture()).toEqual(expected);
      }
    } finally { await browser.close(); }
  });

  it.skipIf(!hasBrowser)('converts browser-serialized reference styles without losing gradient text clipping', async () => {
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      await page.setContent(`<style>${referenceCss}</style>${referenceHtml}`);
      const snapshot = await captureRenderedHtml(page);
      const dom = cheerio.load(snapshot);
      const css = dom('style').text();
      const result = convertDocumentsToTailwind([{ id: 'po-portfoliobox-cssom', html: snapshot }], css, { strict: true });
      const compiled = await compile(result.utilities!);
      await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
      expect(await page.locator('.hero-highlight').evaluate(element => getComputedStyle(element).backgroundClip)).toBe('text');
      expect(await page.locator('.quote-result').evaluate(element => getComputedStyle(element).backgroundClip)).toBe('text');
    } finally { await browser.close(); }
  });

  it.skipIf(!hasBrowser || process.env.VERIFY_PORTFOLIOBOX_LIVE !== '1')('matches gradient text on the live reference after browser capture and conversion', async () => {
    const response = await fetch('https://www.portfoliobox.com/');
    expect(response.ok).toBe(true);
    const dom = cheerio.load(await response.text());
    const sources: string[] = [];
    for (const element of dom('link[rel~="stylesheet"]').toArray()) {
      const url = new URL(dom(element).attr('href')!, 'https://www.portfoliobox.com/');
      if (url.hostname !== 'www.portfoliobox.com') continue;
      const css = await fetch(url);
      expect(css.ok).toBe(true);
      sources.push(await css.text());
    }
    dom('script, link[rel~="stylesheet"]').remove();
    dom('head').append(dom('<style>').text(sources.join('\n')));
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort());
      const capture = () => page.locator('.hero-highlight, .quote-result').evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        return { clip: style.backgroundClip, fill: style.getPropertyValue('-webkit-text-fill-color'), image: style.backgroundImage, color: style.color, display: style.display, fontSize: style.fontSize, filter: style.filter };
      }));
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(dom.html());
        const expected = await capture();
        expect(expected).toHaveLength(2);
        const snapshot = await captureRenderedHtml(page);
        const css = cheerio.load(snapshot)('style').text();
        const result = convertDocumentsToTailwind([{ id: 'po-portfoliobox-live', html: snapshot }], css, { strict: true });
        const compiled = await compile(result.utilities!);
        await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
        expect(await capture()).toEqual(expected);
      }
    } finally { await browser.close(); }
  }, 120000);

  it('resolves prefixed and unprefixed clipping as aliases before background shorthand resets', async () => {
    const result = convertDocumentsToTailwind([{ id: 'aliases', html: '<div class="text">Text</div>' }], '.text{background:linear-gradient(red,blue);-webkit-background-clip:text}', { strict: true });
    const compiled = await compile(result.utilities!);
    expect(compiled).toContain('background-clip: text');
    expect(compiled).not.toContain('background-clip: border-box');
    const reset = convertDocumentsToTailwind([{ id: 'reset', html: '<div class="text">Text</div>' }], '.text{-webkit-background-clip:text;background:blue}', { strict: true });
    const resetCss = await compile(reset.utilities!);
    expect(resetCss).toContain('background-clip: border-box');
    expect(resetCss).not.toContain('background-clip: text');
  });
});
