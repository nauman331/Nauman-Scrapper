import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { TAILWIND_BROWSER_CONFIG, TAILWIND_BROWSER_URL } from '../src/generator/html-exporter.js';

// Explicit network smoke test, separate from deterministic repository tests.
// Run: $env:VERIFY_TAILWIND_CDN='1'; npx vitest run tests/tailwind-cdn-runtime.test.ts
const enabled = process.env.VERIFY_TAILWIND_CDN === '1';
const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
describe('Tailwind CDN export runtime', () => {
  it.skipIf(!enabled || !hasBrowser)('renders native, arbitrary, responsive and hover utilities without exported stylesheets', async () => {
    const response = await fetch(TAILWIND_BROWSER_URL);
    expect(response.ok).toBe(true);
    const runtime = await response.text();
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      await page.route(TAILWIND_BROWSER_URL, route => route.fulfill({ contentType: 'text/javascript', body: runtime }));
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.setContent(`<html><head><script src="${TAILWIND_BROWSER_URL}"></script><script>${TAILWIND_BROWSER_CONFIG}</script></head><body><div id="hero" class="flex gap-3 p-5 w-[240px] bg-[#123456] hover:bg-[#abcdef] md:grid"><span>Content</span></div></body></html>`);
      const hero = page.locator('#hero');
      await expect.poll(() => hero.evaluate(element => getComputedStyle(element).display)).toBe('grid');
      expect(await hero.evaluate(element => getComputedStyle(element).padding)).toBe('20px');
      expect(await hero.evaluate(element => getComputedStyle(element).gap)).toBe('12px');
      expect(await hero.evaluate(element => getComputedStyle(element).width)).toBe('240px');
      await hero.hover();
      await expect.poll(() => hero.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(171, 205, 239)');
      await page.setViewportSize({ width: 500, height: 700 });
      await expect.poll(() => hero.evaluate(element => getComputedStyle(element).display)).toBe('flex');
      expect(await page.locator('link[rel="stylesheet"]').count()).toBe(0);
      // Runtime creates Tailwind CSS in memory, not downloadable CSS dependencies.
      expect(await page.locator('style').count()).toBeGreaterThan(0);
    } finally { await browser.close(); }
  }, 30000);
});
