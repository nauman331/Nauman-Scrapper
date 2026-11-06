import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { AssetCollector } from '../src/generator/assets/asset-collector.js';
import { AssetDownloader } from '../src/generator/assets/asset-downloader.js';
import { extractImages } from '../src/extraction/extractors/image.extractor.js';
import { conversionStorage } from '../src/generator/storage.js';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
afterEach(() => vi.restoreAllMocks());
const base = 'https://site.test/pages/home';
const fixture = `<figure><img src="image.jpg" alt="Example"></figure>
<figure><source src="image.webp"></figure><figure><figcaption>No image</figcaption></figure>
<picture><source src="image.webp" type="image/webp"><img src="image.jpg"></picture>
<picture><source srcset="large.webp 1200w, small.webp 600w" media="(min-width:800px)">
<source data-src="lazy.webp" data-srcset="lazy-large.webp 2x"><img data-src="fallback.jpg"></picture>
<div style="background-image:linear-gradient(red,blue),url('bg(one).jpg'),url(&quot;bg-two.jpg&quot;),url(bg-three.jpg)"></div>
<figure><video><source src="movie.mp4"></video></figure>`;

describe('Image asset extensions', () => {
  it('collects nested figure/picture/lazy candidates and quoted multi-background URLs without duplicates', () => {
    const assets = new AssetCollector().collectAssets(fixture, base);
    const images = assets.filter(asset => asset.type === 'image').map(asset => asset.originalUrl);
    expect(images).toEqual(expect.arrayContaining(['image.jpg', 'image.webp', 'large.webp', 'small.webp', 'lazy.webp', 'lazy-large.webp', 'fallback.jpg', 'bg(one).jpg', 'bg-two.jpg', 'bg-three.jpg'].map(name => 'https://site.test/pages/' + name)));
    expect(new Set(images).size).toBe(images.length);
    expect(images).not.toContain('https://site.test/pages/movie.mp4');
    expect(assets.some(asset => asset.originalUrl.includes('gradient'))).toBe(false);
  });

  it('extends extracted image metadata while preserving the original img first', () => {
    const images = extractImages(load(fixture), base, 100);
    expect(images[0]).toMatchObject({ src: 'https://site.test/pages/image.jpg', alt: 'Example' });
    expect(images.map(image => image.src)).toContain('https://site.test/pages/lazy-large.webp');
    expect(images.map(image => image.src)).toContain('https://site.test/pages/image.webp');
    expect(new Set(images.map(image => image.src)).size).toBe(images.length);
    expect(extractImages(load(fixture), base, 1)).toHaveLength(1);
  });

  it('downloads external and imported backgrounds relative to their own stylesheet and reuses shared image URLs', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/css/main.css')) return new Response('@import "nested/theme.css"; .hero{background-image:url("../img/shared.jpg"),url(../img/second.jpg),linear-gradient(red,blue)}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('/css/nested/theme.css')) return new Response('.nested{background-image:url(../../img/shared.jpg)}', { headers: { 'content-type': 'text/css' } });
      return new Response(url, { headers: { 'content-type': 'image/jpeg' } });
    });
    const collector = new AssetCollector();
    const html = '<link rel="stylesheet" href="/css/main.css"><img src="/img/shared.jpg"><div style="background-image:url(/img/shared.jpg)"></div>';
    const downloader = new AssetDownloader();
    const result = await downloader.resolveAssets('test-images', collector.collectAssets(html, base), [], { generatedPublicAssetUrls: false });
    const requests = fetch.mock.calls.map(([url]) => String(url));
    expect(requests.filter(url => url === 'https://site.test/img/shared.jpg')).toHaveLength(1);
    expect(requests).toContain('https://site.test/img/second.jpg');
    expect(requests).not.toContain('https://site.test/css/img/shared.jpg');
    expect(result.missingAssets).toEqual([]);
    expect(result.consolidatedCss).toContain('linear-gradient(red,blue)');
    const image = result.downloadedAssets.find(asset => asset.originalUrl === 'https://site.test/img/shared.jpg')!;
    expect(result.consolidatedCss).toContain(image.publicUrl);
    const lazyHtml = '<picture><source data-src="/img/shared.jpg"><img data-src="/img/shared.jpg"></picture>';
    const lazy = load(downloader.rewriteAssetUrlsInHtml(lazyHtml, result.downloadedAssets, base));
    expect(lazy('source').attr('srcset')).toBe(image.publicUrl);
    expect(lazy('img').attr('src')).toBe(image.publicUrl);
    expect(lazy('img').attr('data-src')).toBe(image.publicUrl);
    expect(load(downloader.rewriteAssetUrlsInHtml(html, result.downloadedAssets, base))('div').attr('style')).toContain(`url("${image.publicUrl}")`);
  });

  it('recovers originals from blocked Next.js optimizer URLs and maps all responsive aliases locally', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      return url.includes('/_next/image') ? new Response('Forbidden', { status: 403 }) : new Response('original jpeg bytes', { headers: { 'content-type': 'image/jpeg' } });
    });
    const html = '<picture><source media="(min-width:48rem)" srcset="/_next/image?url=%2Fhome%2Fhero.jpg&amp;w=640&amp;q=100 640w, /_next/image?url=%2Fhome%2Fhero.jpg&amp;w=1080&amp;q=100 1080w"><img src="/_next/image?url=%2Fhome%2Fhero.jpg&amp;w=3840&amp;q=100"></picture>';
    const downloader = new AssetDownloader();
    const result = await downloader.resolveAssets('next-picture', new AssetCollector().collectAssets(html, 'https://site.test/'), [], { generatedPublicAssetUrls: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('https://site.test/home/hero.jpg');
    expect(result.missingAssets).toEqual([]);
    const rewritten = load(downloader.rewriteAssetUrlsInHtml(html, result.downloadedAssets, 'https://site.test/'));
    expect(rewritten('img').attr('src')).toMatch(/^\/images\//);
    expect(rewritten('source').attr('srcset')).not.toContain('_next/image');
    expect(rewritten('source').attr('srcset')).toContain('640w');
    expect(rewritten('source').attr('media')).toBe('(min-width:48rem)');
  });

  it('exports figure/picture fallbacks and lazy srcsets as local assets without changing ordinary figures', async () => {
    const id = 'image_extension_' + Date.now();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(String(input), { headers: { 'content-type': 'image/jpeg' } }));
    try {
      await exportStandaloneHtml({ conversionId: id, jobId: 'test', targetUrl: base, domain: 'site.test', pages: [{ url: base, rawData: { html: fixture } }], options: HtmlConversionOptionsSchema.parse({}) });
      const html = (await conversionStorage.readFileSafe(id, 'index.html'))!;
      const $ = load(html);
      expect($('figure').eq(1).find('img').attr('src')).toMatch(/^assets\//);
      expect($('figure').eq(2).find('img')).toHaveLength(0);
      expect($('picture source').first().attr('srcset')).toMatch(/^assets\//);
      expect($('picture source[data-srcset]').attr('srcset')).toMatch(/^assets\//);
      expect($('picture img[data-src]').attr('src')).toMatch(/^assets\//);
      expect($('picture source[media]').attr('media')).toBe('(min-width:800px)');
      expect(html).not.toContain('https://site.test/pages/image.webp');
    } finally { await conversionStorage.deleteConversion(id); }
  });
});
