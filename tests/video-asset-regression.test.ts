import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { AssetCollector } from '../src/generator/assets/asset-collector.js';
import { AssetDownloader } from '../src/generator/assets/asset-downloader.js';
import { conversionStorage } from '../src/generator/storage.js';
import { validateUrlForSsrf } from '../src/core/ssrf/ssrf-validator.js';
import { fetchThroughProxy } from '../src/proxies/proxy-fetch.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
vi.mock('../src/proxies/proxy-fetch.js', () => ({ fetchThroughProxy: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.mocked(validateUrlForSsrf).mockReset().mockResolvedValue({ valid: true });
  vi.mocked(fetchThroughProxy).mockReset();
});
const base = 'https://hsproperty.ae/';
const fixture = `<section class="awards"><figure class="reel"><video class="hero-video" poster="/poster.jpg" autoplay muted loop playsinline style="object-fit:cover">
<source src="/awards-reel-720.mp4" type="video/mp4" media="(max-width:767px)">
<source src="/awards-reel-1080.mp4" type="video/mp4"></video></figure>
<video src="/direct-video" controls></video><video><source src="/second.webm" type="video/webm"></video></section>`;
const collectVideo = (src = '/movie.mp4') => new AssetCollector().collectAssets(`<video src="${src}"></video>`, base);
const streamResponse = (chunks: Uint8Array[], contentType = 'video/mp4') => new Response(new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
}), { headers: { 'content-type': contentType } });

describe('video asset export reliability', () => {
  it('downloads all responsive sources and direct videos over 10MB and preserves markup and source ordering', async () => {
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const chunk = new Uint8Array(1024 * 1024);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('poster.jpg')) return new Response('poster', { headers: { 'content-type': 'image/jpeg' } });
      // Distinct content, split into chunks, exceeds the old cap without Content-Length.
      return streamResponse([new Uint8Array([url.length]), ...Array.from({ length: 11 }, () => chunk)], url.endsWith('.webm') ? 'video/webm' : 'video/mp4');
    });
    const downloader = new AssetDownloader();
    const assets = new AssetCollector().collectAssets(fixture, base);
    expect(assets.filter(asset => asset.type === 'video').map(asset => asset.originalUrl)).toEqual([
      base + 'direct-video', base + 'awards-reel-720.mp4', base + 'awards-reel-1080.mp4', base + 'second.webm',
    ]);
    const result = await downloader.resolveAssets('video-test', assets, [], { assetRoot: 'cloned-assets' });
    expect(result.missingAssets).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.downloadedAssets).toHaveLength(5);
    for (const asset of result.downloadedAssets.filter(asset => asset.mimeType.startsWith('video/'))) {
      expect(asset.sizeBytes).toBe(11 * 1024 * 1024 + 1);
      expect(asset.publicUrl).toMatch(/^\/cloned-assets\/images\/.*\.(mp4|webm)$/);
      expect(asset.isImage).toBe(false);
      expect(write).toHaveBeenCalledWith('video-test', `public${asset.publicUrl}`, expect.any(Buffer));
    }
    const $ = load(downloader.rewriteAssetUrlsInHtml(fixture, result.downloadedAssets, base));
    const original = load(fixture);
    expect($('section.awards > figure.reel > video.hero-video')).toHaveLength(1);
    const video = $('video.hero-video');
    for (const attribute of ['autoplay', 'muted', 'loop', 'playsinline', 'style', 'class']) {
      expect(video.attr(attribute)).toBe(original('video.hero-video').attr(attribute));
    }
    expect(video.attr('poster')).toMatch(/^\/cloned-assets\/images\//);
    expect(video.find('source').map((_, el) => $(el).attr('src')).get()).toEqual([
      result.downloadedAssets.find(asset => asset.originalUrl.endsWith('awards-reel-720.mp4'))!.publicUrl,
      result.downloadedAssets.find(asset => asset.originalUrl.endsWith('awards-reel-1080.mp4'))!.publicUrl,
    ]);
    expect(video.find('source').first().attr('media')).toBe('(max-width:767px)');
    expect(video.find('source').last().attr('media')).toBeUndefined();
    expect(video.find('source').map((_, el) => $(el).attr('type')).get()).toEqual(['video/mp4', 'video/mp4']);
    expect($('video[controls]').attr('src')).toMatch(/^\/cloned-assets\/images\//);
  });

  it('reuses downloaded video URLs in CSS without turning local /images paths into remote URLs', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([new Uint8Array([1])]));
    const result = await new AssetDownloader().resolveAssets('video-css', collectVideo(), [{
      sourceUrl: base, css: '.reel{--asset:url("/movie.mp4");object-fit:cover}',
    }], { generatedPublicAssetUrls: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.consolidatedCss).toBe(`.reel{--asset:url("${result.downloadedAssets[0].publicUrl}");object-fit:cover}`);
    expect(result.downloadedAssets[0].publicUrl).toMatch(/^\/images\//);
  });

  it('keeps the timeout active while reading the body and retries stalled streams without writing partial files', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        init!.signal!.addEventListener('abort', () => controller.error(new Error('body timed out')), { once: true });
      },
    }), { headers: { 'content-type': 'video/mp4' } }));
    const pending = new AssetDownloader().resolveAssets('video-timeout', collectVideo());
    await vi.advanceTimersByTimeAsync(361000);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(write).not.toHaveBeenCalled();
    expect(result.downloadedAssets).toEqual([]);
    expect(result.missingAssets).toEqual([base + 'movie.mp4 (body timed out)']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries interrupted body reads and saves only the complete retry', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection reset')); } })))
      .mockResolvedValueOnce(streamResponse([new Uint8Array([1, 2, 3])]));
    const pending = new AssetDownloader().resolveAssets('video-retry', collectVideo());
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.missingAssets).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][2]).toEqual(Buffer.from([1, 2, 3]));
  });

  it.each([
    { name: 'HTTP failure', response: () => new Response('missing', { status: 404 }), reason: 'HTTP 404' },
    { name: 'HTML access challenge', response: () => new Response('challenge', { headers: { 'content-type': 'text/html' } }), reason: 'Expected video but received HTML' },
    { name: 'video size cap', response: () => new Response('too big', { headers: { 'content-length': String(512 * 1024 * 1024 + 1) } }), reason: 'Exceeded 512MB size limit' },
  ])('reports $name without writing a bogus video or retrying permanent errors', async ({ response, reason }) => {
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const result = await new AssetDownloader().resolveAssets('video-error', collectVideo());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(result.missingAssets[0]).toContain(reason);
    expect(result.downloadedAssets).toEqual([]);
  });

  it('enforces the ordinary asset limit incrementally and cancels an oversized stream', async () => {
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const cancel = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); }, cancel,
    })));
    const result = await new AssetDownloader().resolveAssets('image-limit', new AssetCollector().collectAssets('<img src="/image.png">', base));
    expect(result.missingAssets[0]).toContain('Exceeded 10MB size limit');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('validates redirected video URLs before requesting them', async () => {
    vi.mocked(validateUrlForSsrf).mockImplementation(async url => url.includes('127.0.0.1') ? { valid: false, error: 'private IP' } : { valid: true });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/movie.mp4' } }));
    const result = await new AssetDownloader().resolveAssets('video-ssrf', collectVideo());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.redirect).toBe('manual');
    expect(result.missingAssets[0]).toContain('Blocked asset URL: private IP');
  });

  it('passes the video cap and active abort signal to the selected proxy and follows redirects on that proxy', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const direct = vi.spyOn(globalThis, 'fetch');
    vi.mocked(fetchThroughProxy)
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/cdn/movie.mp4' } }))
      .mockResolvedValueOnce(streamResponse([new Uint8Array([1])]));
    const result = await new AssetDownloader().resolveAssets('video-proxy', collectVideo(), [], { proxyUrl: 'http://proxy.test' });
    expect(result.missingAssets).toEqual([]);
    expect(direct).not.toHaveBeenCalled();
    expect(fetchThroughProxy).toHaveBeenCalledTimes(2);
    expect(fetchThroughProxy).toHaveBeenLastCalledWith(base + 'cdn/movie.mp4', 'http://proxy.test', expect.objectContaining({ maxBytes: 512 * 1024 * 1024, signal: expect.any(AbortSignal) }));
  });

  it('retries transient HTTP errors and rejects empty video responses', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(streamResponse([new Uint8Array([4])]));
    const pending = new AssetDownloader().resolveAssets('video-http-retry', collectVideo());
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.missingAssets).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][2]).toEqual(Buffer.from([4]));
  });

  it('deduplicates shared video URLs and identical source bytes without losing aliases', async () => {
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-file');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => streamResponse([new Uint8Array([1])]));
    const html = '<video src="/movie.mp4"><source src="/movie.mp4"></video><video><source src="/alias.mp4"></video>';
    const downloader = new AssetDownloader();
    const result = await downloader.resolveAssets('video-dedupe', new AssetCollector().collectAssets(html, base));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.downloadedAssets).toHaveLength(2);
    const $ = load(downloader.rewriteAssetUrlsInHtml(html, result.downloadedAssets, base));
    expect($('video[src]').attr('src')).toBe(result.downloadedAssets[0].publicUrl);
    expect($('source').map((_, el) => $(el).attr('src')).get()).toEqual([result.downloadedAssets[0].publicUrl, result.downloadedAssets[0].publicUrl]);
  });

  it('retains network cause diagnostics after bounded retries', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed', { cause: { code: 'ECONNRESET', message: 'socket closed' } }));
    const pending = new AssetDownloader().resolveAssets('video-diagnostics', collectVideo());
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).missingAssets[0]).toContain('fetch failed: ECONNRESET: socket closed');
  });
});
