import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { waitForRenderedContent } from '../src/crawlers/render-readiness.js';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';

const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
const launch = () => chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
describe.skipIf(!hasBrowser)('Aixploria scroll capture', () => {
  it('reveals lower sections on a long directory page within a short capture budget', async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.setContent(`<style>body{margin:0}.directory{height:22000px}.aixploria-section{height:400px}.aixploria-section p{opacity:0}.aix-revealed p{opacity:1}</style>
        <h1>The World's Best AI Tools Directory</h1><div class="directory">Directory cards</div>
        ${Array.from({ length: 5 }, (_, i) => `<section class="aixploria-section"><h2>Section ${i + 1}</h2><p>Lazy information section ${i + 1}</p></section>`).join('')}
        <script>const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('aix-revealed');observer.unobserve(entry.target)}}),{threshold:.08,rootMargin:'0px 0px -40px 0px'});document.querySelectorAll('.aixploria-section').forEach(section=>observer.observe(section));</script>`);
      await waitForRenderedContent(page, 2000);
      const snapshot = await captureRenderedHtml(page);
      const dom = cheerio.load(snapshot);
      expect(dom('.aix-revealed')).toHaveLength(5);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.setContent(snapshot.replace(/<script[\s\S]*?<\/script>/gi, ''));
      for (const paragraph of await page.locator('.aixploria-section p').all()) expect(await paragraph.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    } finally { await browser.close(); }
  }, 15000);

  it.skipIf(process.env.VERIFY_AIXPLORIA_LIVE !== '1')('captures every lower information section and keeps them visible without source scripts', async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const response = await fetch('https://www.aixploria.com/en/');
      expect(response.ok).toBe(true);
      const sourceHtml = await response.text();
      await page.route('https://www.aixploria.com/en/', route => route.fulfill({ contentType: 'text/html', body: sourceHtml }));
      await page.goto('https://www.aixploria.com/en/', { waitUntil: 'load', timeout: 60000 });
      await waitForRenderedContent(page, 20000);
      const snapshot = await captureRenderedHtml(page);
      const dom = cheerio.load(snapshot);
      expect(dom('.aixploria-section').length).toBeGreaterThanOrEqual(6);
      const css = dom('style').toArray().map(element => dom(element).text()).join('\n');
      const result = convertDocumentsToTailwind([{ id: 'aixploria', html: snapshot }], css, { strict: true });
      const compiled = (await postcss([tailwindcss({ content: [], safelist: result.utilities!, corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined })).css;
      const output = cheerio.load(result.documents[0].html);
      output('script').remove(); output('head').append(output('<style>').text(compiled));
      await page.route('**/*', route => route.abort());
      await page.setContent(output.html());
      for (const section of await page.locator('.aixploria-section').all()) {
        await section.scrollIntoViewIfNeeded();
        const state = await section.evaluate(element => {
          const text = element.querySelector('p') || element;
          let opacity = 1;
          for (let parent: Element | null = text; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
          return { heading: element.querySelector('h2,h3')?.textContent, opacity, visibility: getComputedStyle(text).visibility, text: element.textContent?.trim().length || 0 };
        });
        expect(state.opacity, state.heading || 'section').toBeGreaterThan(.99);
        expect(state.visibility).toBe('visible'); expect(state.text).toBeGreaterThan(100);
      }
    } finally { await browser.close(); }
  }, 120000);
});
