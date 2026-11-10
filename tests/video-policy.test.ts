import { existsSync } from 'node:fs';
import { load } from 'cheerio';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { applyVideoPolicy } from '../src/generator/video-policy.js';
import { sanitizeStandaloneHtml } from '../src/generator/html-exporter.js';
import { sanitizeExactHtml } from '../src/generator/exact-exporter.js';
import { htmlToJsx } from '../src/generator/codegen/jsx-transformer.js';
import { captureRenderedHtml } from '../src/crawlers/rendered-snapshot.js';

const review = (overrides = {}) => JSON.stringify({ version: 1, role: 'foreground', controls: false, autoplay: false, playing: false, muted: false, loop: false, playsInline: false, visible: true, objectFit: 'contain', ...overrides });
const fixture = (overrides = {}) => {
  const $ = load('<video autoplay="false" poster="/poster.jpg"><source src="/mobile.mp4" media="(max-width:767px)"><source src="/desktop.mp4"></video>');
  $('video').attr('data-captured-video-review', review(overrides));
  return $.html();
};

describe('source-reviewed clone video policy', () => {
  it.each([applyVideoPolicy, sanitizeStandaloneHtml, sanitizeExactHtml])('enforces foreground native controls and no autoplay in each export path', transform => {
    const html = fixture({ autoplay: true, playing: true });
    const $ = load(transform(html, []));
    expect($('video').attr('controls')).toBeDefined();
    expect($('video').attr('autoplay')).toBeUndefined();
    expect($('video').attr('poster')).toBe('/poster.jpg');
    expect($('source').map((_, el) => $(el).attr('src')).get()).toEqual(['/mobile.mp4', '/desktop.mp4']);
    expect($('source').first().attr('media')).toBe('(max-width:767px)');
    expect($('video').attr('style')).toContain('pointer-events:auto!important');
  });

  it('does not guess backgrounds from autoplay, loop or a hero class in unreviewed snapshots', () => {
    const warnings: string[] = [];
    const $ = load(applyVideoPolicy('<video class="hero-video" autoplay muted loop></video>', warnings));
    expect($('video').attr('autoplay')).toBeUndefined();
    expect($('video').attr('controls')).toBeDefined();
    expect(warnings.join(' ')).toContain('Re-scrape with Playwright');
  });

  it('replays observed playing backgrounds muted and inline without inventing loops', () => {
    const $ = load(applyVideoPolicy(fixture({ role: 'background', playing: true }), []));
    for (const attr of ['autoplay', 'muted', 'playsinline']) expect($('video').attr(attr)).toBeDefined();
    expect($('video').attr('controls')).toBeUndefined();
    expect($('video').attr('loop')).toBeUndefined();
  });

  it.each([applyVideoPolicy, sanitizeStandaloneHtml, sanitizeExactHtml])('preserves H&S background autoplay intent and no controls even when paused at capture', transform => {
    const html = fixture({ role: 'background', autoplay: true, playing: false, muted: true, loop: true, objectFit: 'cover' });
    const result = transform(html, []);
    const $ = load(result);
    expect($('video').attr('autoplay')).toBeDefined();
    expect($('video').attr('controls')).toBeUndefined();
    expect($('video').attr('loop')).toBeDefined();
    expect($('video').attr('style')).toBeUndefined();
    expect(transform(result, [])).toBe(result);
    expect(htmlToJsx(result).jsx).toContain('autoPlay={true}');
    expect(htmlToJsx(result).jsx).not.toContain(' controls=');
  });

  it('keeps genuinely paused backgrounds paused without inventing controls', () => {
    const $ = load(applyVideoPolicy(fixture({ role: 'background', autoplay: false, playing: false }), []));
    expect($('video').attr('autoplay')).toBeUndefined();
    expect($('video').attr('controls')).toBeUndefined();
  });

  it('retains source controls when a reviewed background explicitly has them', () => {
    const $ = load(applyVideoPolicy(fixture({ role: 'background', controls: true, autoplay: true }), []));
    expect($('video').attr('controls')).toBeDefined();
    expect($('video').attr('autoplay')).toBeDefined();
  });

  it('handles invalid evidence safely and is idempotent', () => {
    for (const value of ['broken json', review({ playing: 'yes' }), review({ version: 2 })]) {
      const $ = load(fixture());
      $('video').attr('data-captured-video-review', value);
      const result = applyVideoPolicy($.html());
      expect(load(result)('video').attr('autoplay')).toBeUndefined();
      expect(applyVideoPolicy(result)).toBe(result);
    }
  });

  it('keeps the foreground policy and background boolean attributes through JSX conversion', () => {
    const foreground = htmlToJsx(applyVideoPolicy(fixture({ playing: true }))).jsx;
    expect(foreground).toContain('controls');
    expect(foreground).not.toContain('autoPlay');
    const background = htmlToJsx(applyVideoPolicy(fixture({ role: 'background', playing: true, loop: true }))).jsx;
    expect(background).toContain('autoPlay');
    expect(background).toContain('muted');
    expect(background).toContain('playsInline');
  });
});

const hasBrowser = existsSync(chromium.executablePath()) || existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
describe.skipIf(!hasBrowser)('live original-page video review', () => {
  it('observes runtime state and CSS backgrounds without changing the original videos', async () => {
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      await page.setContent('<style>section{position:relative;width:400px;height:200px}#background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}</style><section><video id="background"></video><h1>Hero copy</h1></section><video id="foreground" class="hero-video"></video><video id="native" controls></video><video id="hidden" hidden></video><div aria-hidden="true"><video id="decorative" autoplay muted loop></video></div>');
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const video = document.querySelector<HTMLVideoElement>('#background')!;
        video.muted = true; video.loop = true;
        video.srcObject = canvas.captureStream(10);
        const context = canvas.getContext('2d')!;
        const timer = setInterval(() => context.fillRect(0, 0, 32, 32), 50);
        await video.play();
        clearInterval(timer);
      });
      const snapshot = await captureRenderedHtml(page);
      const $ = load(snapshot);
      const observed = (id: string) => JSON.parse($(id).attr('data-captured-video-review')!);
      expect(observed('#background')).toMatchObject({ role: 'background', playing: true, autoplay: false, muted: true, loop: true, objectFit: 'cover' });
      expect(observed('#foreground')).toMatchObject({ role: 'foreground', controls: false, playing: false });
      expect(observed('#native')).toMatchObject({ role: 'foreground', controls: true, visible: true });
      expect(observed('#hidden').visible).toBe(false);
      expect(observed('#decorative')).toMatchObject({ role: 'background', controls: false, autoplay: true, playing: false });
      const decorative = load(applyVideoPolicy(snapshot))('#decorative');
      expect(decorative.attr('controls')).toBeUndefined();
      expect(decorative.attr('autoplay')).toBeDefined();
      expect(await page.locator('#background').getAttribute('data-captured-video-review')).toBeNull();
      expect(await page.locator('#background').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
      const clone = load(applyVideoPolicy(snapshot));
      expect(clone('#background').attr('autoplay')).toBeDefined();
      expect(clone('#foreground').attr('controls')).toBeDefined();
      expect(clone('#foreground').attr('autoplay')).toBeUndefined();
    } finally { await browser.close(); }
  }, 15000);
});
