import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { externalizeInlineStyles } from '../src/generator/html-exporter.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';

const css = 'body{margin:0}.review{margin:0;max-width:640px;text-align:center}.page .review{margin-left:auto;margin-right:auto}@media(min-width:800px){.review{width:60%}}';
const html = '<main class="page"><section class="review"><h2>Centered customer review</h2><p>Heading and description</p></section></main>';

describe('Centered layout cascade preservation', () => {
  it('preserves shorthand and complex-selector auto margins together', () => {
    const result = convertDocumentsToTailwind([{ id: 'home', html }], css);
    expect(result.residualCss).toContain('margin:0');
    expect(result.residualCss).toContain('margin-left:auto');
    expect(result.residualCss).toContain('margin-right:auto');
    expect(result.documents[0].html).not.toContain('m-[0]');
  });
  it('preserves inline geometry instead of moving it to conflicting utilities', () => {
    const result = convertDocumentsToTailwind([{ id: 'home', html: '<div class="box" style="margin:0 auto;max-width:600px;text-align:center">Copy</div>' }], '.box{margin-left:0}');
    expect(result.documents[0].html).toContain('margin:0 auto');
    expect(result.documents[0].html).toContain('max-width:600px');
    expect(result.documents[0].html).toContain('text-align:center');
  });
  const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
  it.skipIf(!hasBrowser)('preserves inline centering and important captured paint after externalization', async () => {
    const source = '<main id="main"><section id="review" style="margin:0 auto;width:600px;text-align:center;opacity:1!important">Review</section></main>';
    const styles = '#main #review{margin-left:0;opacity:0!important}';
    const result = externalizeInlineStyles(source, styles, 'test');
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page.setContent('<style>body{margin:0}' + styles + result.css + '</style>' + result.html);
      const rect = await page.locator('#review').boundingBox();
      expect(rect!.x + rect!.width / 2).toBeCloseTo(500, 1);
      expect(await page.locator('#review').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      expect(await page.locator('#review').getAttribute('style')).toBeNull();
    } finally { await browser.close(); }
  }, 20000);
  it.skipIf(!hasBrowser)('keeps the exported section centered at desktop and mobile viewport widths', async () => {
    const result = convertDocumentsToTailwind([{ id: 'home', html }], css);
    const externalized = externalizeInlineStyles(result.documents[0].html, css, 'test');
    const compiled = await postcss([tailwindcss({ content: [{ raw: result.documents[0].html, extension: 'html' }], corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined });
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await page.setContent('<style>' + css + '</style>' + html);
        const original = await page.locator('.review').boundingBox();
        await page.setContent('<style>' + compiled.css + '\n' + result.residualCss + '\n' + externalized.css + '</style>' + externalized.html);
        const exported = await page.locator('.review').boundingBox();
        expect(exported!.x).toBeCloseTo(original!.x, 1);
        expect(exported!.width).toBeCloseTo(original!.width, 1);
        expect(exported!.x + exported!.width / 2).toBeCloseTo(width / 2, 1);
        expect(await page.locator('.review').evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
      }
    } finally { await browser.close(); }
  }, 20000);
});
