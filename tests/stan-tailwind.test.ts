import { it, expect } from 'vitest';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';
import { waitForRenderedContent } from '../src/crawlers/render-readiness.js';
import { sanitizeStandaloneHtml } from '../src/generator/html-exporter.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';

it.skipIf(process.env.VERIFY_STAN !== '1')('preserves Stan captured banner styling in Tailwind', async () => {
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('https://stan.store/', { waitUntil: 'domcontentloaded' });
    await waitForRenderedContent(page, 5000);
    const source = sanitizeStandaloneHtml(await captureRenderedHtml(page), []);
    const urls = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href).filter(url => url.startsWith('https://stan.store/')));
    // Keep the same loaded fonts in both comparisons; custom font packaging is
    // separately reported by the converter and is not this layout regression.
    const fontUrls = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href).filter(url => url.startsWith('https://fonts.googleapis.com/')));
    const fontCss = (await Promise.all(fontUrls.map(async url => (await fetch(url)).text()))).join('\n');
    const css = (await Promise.all(urls.map(async url => (await fetch(url)).text()))).join('\n');
    const result = convertDocumentsToTailwind([{ id: 'stan', html: source }], css, { strict: true });
    const compiled = (await postcss([tailwindcss({ content: [], safelist: result.utilities!, corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined })).css;
    const props = ['display','position','width','height','padding','margin','fontSize','lineHeight','opacity','visibility','transform','top','left','right','bottom','boxSizing','color','backgroundColor'];
    const snapshot = () => page.evaluate(props => Array.from(document.querySelectorAll('body, body *')).filter(element => !['SCRIPT','STYLE','LINK','SVG','PATH'].includes(element.tagName)).slice(0, 100).map(element => ({ tag: element.tagName, id: element.id, text: element.textContent?.trim().slice(0, 30), styles: Object.fromEntries(props.map(prop => [prop, (getComputedStyle(element) as any)[prop]])) })), props);
    // Compare the same captured, script-free document with source versus utilities.
    for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(source.replace(/<head[^>]*>/i, match => `${match}<style>${fontCss}\n${css}</style>`));
    await page.evaluate(() => document.fonts.ready);
    const before = await snapshot();
    await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${fontCss}\n${compiled}</style>`));
    await page.evaluate(() => document.fonts.ready);
    const after = await snapshot();
    const equivalent = (a: string, b: string) => a === b || (/^-?[\d.]+px$/.test(a) && /^-?[\d.]+px$/.test(b) && Math.abs(parseFloat(a) - parseFloat(b)) <= .1);
    const diffs = before.flatMap((element, index) => Object.entries(element.styles).filter(([key,value]) => !equivalent(value, after[index]?.styles[key] || '')).map(([key,value]) => ({ tag: element.tag, id: element.id, text:element.text, property:key, before:value, after:after[index]?.styles[key] })));
    expect(result.warnings.some(warning => /lower-priority declaration omitted/.test(warning.message))).toBe(false);
    expect(diffs, `Viewport ${width}px`).toEqual([]);
    if (width === 1280) await page.screenshot({ path: 'storage/stan-tailwind-banner-verified.png' });
    }
  } finally { await browser.close(); }
}, 60000);
