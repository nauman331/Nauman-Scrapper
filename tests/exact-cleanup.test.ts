import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { cleanupExactSnapshot } from '../src/generator/exact-cleanup.js';

describe('exact-only captured blocker cleanup', () => {
  it('removes named cookies, vendors, hashed markers, ads and newsletters but protects content', () => {
    const warnings: string[] = [];
    const result = cleanupExactSnapshot(`<html class="no-scroll theme" style="overflow:hidden"><body class="modal-open source" style="position:fixed;touch-action:none;color:red">
      <header class="cookie-banner">Genuine header<nav>Navigation</nav></header>
      <main class="modal"><section class="banner hero promotion">Genuine hero</section><article>Article content</article></main>
      <footer>Footer</footer><div class="banner">Ordinary banner</div>
      <div class="cookieBanner_ab123">Cookies</div><div id="onetrust-banner-sdk">Consent</div>
      <div class="hash_42" data-captured-transient-ui="true"><div class="newsletter-popup">Nested notice</div></div>
      <aside class="ad-slot"><img src="/ad.png"></aside><div class="newsletter-modal">Subscribe</div>
      <div class="dmca-notice">Blocked</div><div role="dialog">Interruption</div>
      <div class="menu" hidden>Hidden menu</div></body></html>`, warnings);
    const $ = cheerio.load(result.html);
    expect(result.removed).toBe(7);
    expect($('main article').text()).toBe('Article content');
    expect($('header').text()).toContain('Genuine header');
    expect($('.hero').text()).toBe('Genuine hero');
    expect($('footer').text()).toBe('Footer');
    expect($('.banner:not(.hero)').text()).toBe('Ordinary banner');
    expect($('[data-captured-transient-ui], .ad-slot, .newsletter-modal, [role="dialog"]')).toHaveLength(0);
    expect($('body').attr('class')).toBe('source');
    expect($('html').attr('class')).toBe('theme');
    expect($('body').attr('style')).toContain('color:red');
    expect($('body').attr('style')).toContain('overflow:auto!important');
    expect($('body').attr('style')).not.toMatch(/position:fixed|touch-action:none/);
    expect($('.menu').attr('hidden')).toBeDefined();
    expect(warnings.join(' ')).toContain('Removed 7');
    expect(warnings.join(' ')).toContain('cannot be recovered');
  });
  it('does not remove a generic overlay or unlock/reveal unrelated UI without a recognized blocker', () => {
    const result = cleanupExactSnapshot('<body style="overflow:hidden"><div class="overlay">Image caption</div><div class="newsletter">Editorial newsletter article</div><nav hidden>Menu</nav></body>', []);
    expect(result.removed).toBe(0);
    expect(result.html).toContain('overflow:hidden');
    expect(result.html).toContain('Editorial newsletter article');
    expect(result.html).toContain('hidden=""');
  });
  it('rejects only cleanup that empties useful captured body, not a site name or text', () => {
    expect(() => cleanupExactSnapshot('<body><div class="cookie-banner">Only consent</div></body>', [])).toThrow('emptied the useful captured body');
    expect(() => cleanupExactSnapshot('<body><div class="dmca-notice">DMCA</div><article>DMCA reporting article</article></body>', [])).not.toThrow();
  });
});
