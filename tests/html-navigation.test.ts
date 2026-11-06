import { describe, expect, it } from 'vitest';
import { HtmlNavigation } from '../src/generator/html-navigation.js';

const pages = [{ url: 'https://site.test/', path: 'index.html' }, { url: 'https://site.test/about/', path: 'pages/about.html' }];
describe('Exported HTML navigation', () => {
  it('localizes original-domain URLs, protocol/www variants, fragments and tracking queries', () => {
    const navigation = new HtmlNavigation(pages, pages[0].url);
    expect(navigation.resolve(new URL('http://www.site.test/about?utm_source=nav#team'), 'index.html')).toEqual({ href: 'pages/about.html?utm_source=nav#team', missing: false });
    expect(navigation.resolve(new URL('https://site.test/index.html#home'), 'pages/about.html')).toEqual({ href: '../index.html#home', missing: false });
    expect(navigation.resolve(new URL('https://site.test/about/'), 'pages/about.html')).toEqual({ href: 'about.html', missing: false });
  });
  it('does not send uncaptured source routes back online or rewrite unrelated hosts', () => {
    const navigation = new HtmlNavigation(pages, pages[0].url);
    expect(navigation.resolve(new URL('https://site.test/missing'), 'index.html')).toEqual({ href: '#', missing: true });
    expect(navigation.resolve(new URL('https://other.test/about'), 'index.html')).toBeNull();
    expect(navigation.resolve(new URL('https://site.test.evil.test/about'), 'index.html')).toBeNull();
  });
  it('matches distinct query-based pages without guessing ambiguous variants', () => {
    const navigation = new HtmlNavigation([
      { url: 'https://site.test/item?id=1', path: 'pages/item.html' },
      { url: 'https://site.test/item?id=2', path: 'pages/item-2.html' },
    ], pages[0].url);
    expect(navigation.resolve(new URL('https://site.test/item?id=2#details'), 'index.html')).toEqual({ href: 'pages/item-2.html?id=2#details', missing: false });
    expect(navigation.resolve(new URL('https://site.test/item?id=3'), 'index.html')?.missing).toBe(true);
  });
});
