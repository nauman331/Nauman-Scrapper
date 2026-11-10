import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetDownloader } from '../src/generator/assets/asset-downloader.js';
import type { DiscoveredAsset } from '../src/generator/assets/asset-collector.js';
import type { DownloadedAsset } from '../src/generator/types.js';
import { conversionStorage } from '../src/generator/storage.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
afterEach(() => vi.restoreAllMocks());

const asset = (url: string, type: DiscoveredAsset['type'] = 'image'): DiscoveredAsset => ({
  originalUrl: url, sourcePageUrl: 'https://site.test/', type, suggestedLocalName: url.split('/').pop()!,
});
const context = () => ({ downloaded: [] as DownloadedAsset[], missing: [] as string[], seenUrls: new Set<string>(), seenHashes: new Map<string, DownloadedAsset>(), generatedPublicAssetUrls: false });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function controlledFetch() {
  const pending: Array<{ url: string; finish: () => void }> = [];
  let active = 0;
  let peak = 0;
  let videos = 0;
  let peakVideos = 0;
  const hosts = new Map<string, number>();
  const peaks = new Map<string, number>();
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    const host = new URL(url).hostname;
    const video = url.endsWith('.mp4');
    active++;
    peak = Math.max(peak, active);
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    peaks.set(host, Math.max(peaks.get(host) ?? 0, hosts.get(host)!));
    if (video) peakVideos = Math.max(peakVideos, ++videos);
    // Keep permits occupied until the response body is consumed, not just headers.
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      pending.push({ url, finish: () => {
        controller.enqueue(Buffer.from(url));
        controller.close();
        active--;
        hosts.set(host, hosts.get(host)! - 1);
        if (video) videos--;
      } });
    } }), { headers: { 'content-type': video ? 'video/mp4' : 'image/png' } });
  });
  return { pending, mock, get peak() { return peak; }, get peakVideos() { return peakVideos; }, peaks };
}

async function drain(network: ReturnType<typeof controlledFetch>, requests: number) {
  let finished = 0;
  for (let pass = 0; pass < 100 && finished < requests; pass++) {
    await tick();
    for (const request of network.pending.splice(0)) { request.finish(); finished++; }
  }
  expect(finished).toBe(requests);
}

describe('Bounded asset downloads', () => {
  it('downloads concurrently with global, per-host and video limits through body completion', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const network = controlledFetch();
    const assets = [
      ...Array.from({ length: 6 }, (_, i) => asset(`https://host${i % 3}.test/${i}.png`)),
      asset('https://video-a.test/a.mp4', 'video'), asset('https://video-b.test/b.mp4', 'video'),
    ];
    const result = new AssetDownloader().resolveAssets('parallel', assets);
    await tick();
    expect(network.pending).toHaveLength(4);
    await drain(network, assets.length);
    expect((await result).missingAssets).toEqual([]);
    expect(network.peak).toBe(4);
    expect(Math.max(...network.peaks.values())).toBeLessThanOrEqual(2);
    expect(network.peakVideos).toBe(1);
  });

  it('limits a single host to two and honors explicit concurrency overrides', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const network = controlledFetch();
    const assets = Array.from({ length: 6 }, (_, i) => asset(`https://site.test/${i}.png`));
    const downloader = new AssetDownloader();
    const first = downloader.resolveAssets('host-limit', assets);
    await tick();
    expect(network.pending).toHaveLength(2);
    await drain(network, assets.length);
    await first;
    expect(network.peak).toBe(2);
    const serial = downloader.resolveAssets('serial', assets, [], { downloadLimits: { maxConcurrent: 1 } });
    await tick();
    expect(network.pending).toHaveLength(1);
    await drain(network, assets.length);
    await serial;
  });

  it('shares in-flight URL downloads and optimizer aliases without returning null or deadlocking', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const network = controlledFetch();
    const shared = context();
    const downloader = new AssetDownloader();
    const original = 'https://site.test/hero.png';
    const requests = [original, original, 'https://site.test/_next/image?url=%2Fhero.png&w=640', 'https://site.test/_next/image?url=%2Fhero.png&w=1200'];
    const results = requests.map(url => downloader.downloadAsset('dedupe', url, 'image', undefined, shared));
    await drain(network, 1);
    const records = await Promise.all(results);
    expect(records.every(Boolean)).toBe(true);
    expect(new Set(records.map(record => record!.publicUrl)).size).toBe(1);
    expect(network.mock).toHaveBeenCalledTimes(1);
    expect(shared.downloaded).toHaveLength(3);
  });

  it('shares pending content writes across different URLs', async () => {
    let finishWrite!: () => void;
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockImplementation(() => new Promise(resolve => { finishWrite = () => resolve('mock'); }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('identical bytes', { headers: { 'content-type': 'image/png' } }));
    const shared = context();
    const downloader = new AssetDownloader();
    const results = ['a.png', 'b.png'].map(name => downloader.downloadAsset('hash', `https://site.test/${name}`, 'image', undefined, shared));
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    finishWrite();
    const records = await Promise.all(results);
    expect(records[0]!.publicUrl).toBe(records[1]!.publicUrl);
    expect(shared.downloaded).toHaveLength(2);
  });

  it('parallelizes CSS dependencies while preserving imports, stylesheet order and media conditions', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const network = controlledFetch();
    const transport = network.mock.getMockImplementation()!;
    network.mock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('first.css')) return new Response('@import "nested.css"; .first{color:red}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('nested.css')) return new Response('.nested{background:url(https://a.test/a.png)} @font-face{src:url(https://b.test/b.woff2)} .more{background:url(https://c.test/c.svg)}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('last.css')) return new Response('.last{color:blue}', { headers: { 'content-type': 'text/css' } });
      return transport(input, init);
    });
    const first = asset('https://site.test/first.css', 'stylesheet');
    const last = asset('https://site.test/last.css', 'stylesheet');
    const result = new AssetDownloader().resolveAssets('css', [first, last], [], { generatedPublicAssetUrls: false, cssSources: [
      { asset: first, sourceUrl: first.originalUrl }, { css: '.middle{color:green}', sourceUrl: 'https://site.test/', media: 'print' }, { asset: last, sourceUrl: last.originalUrl },
    ] });
    await tick();
    expect(network.pending).toHaveLength(3);
    await drain(network, 3);
    const resolved = await result;
    expect(resolved.missingAssets).toEqual([]);
    expect(resolved.consolidatedCss.indexOf('.nested')).toBeLessThan(resolved.consolidatedCss.indexOf('.first'));
    expect(resolved.consolidatedCss.indexOf('.first')).toBeLessThan(resolved.consolidatedCss.indexOf('.middle'));
    expect(resolved.consolidatedCss.indexOf('.middle')).toBeLessThan(resolved.consolidatedCss.indexOf('.last'));
    expect(resolved.consolidatedCss).toContain('@media print{');
    expect(resolved.consolidatedCss).not.toContain('@import');
    expect(resolved.downloadedAssets.some(record => record.isFont)).toBe(true);
    expect(resolved.downloadedAssets.some(record => record.isSvg)).toBe(true);
  });

  it('applies per-host limits again at redirect destinations', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const network = controlledFetch();
    const transport = network.mock.getMockImplementation()!;
    network.mock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== 'cdn.test') return new Response(null, { status: 302, headers: { location: `https://cdn.test${url.pathname}` } });
      return transport(input, init);
    });
    const assets = Array.from({ length: 4 }, (_, i) => asset(`https://source${i}.test/${i}.png`));
    const result = new AssetDownloader().resolveAssets('redirects', assets);
    await tick();
    expect(network.pending).toHaveLength(2);
    expect(network.pending.every(request => new URL(request.url).hostname === 'cdn.test')).toBe(true);
    await drain(network, assets.length);
    expect((await result).missingAssets).toEqual([]);
    expect(network.peaks.get('cdn.test')).toBe(2);
  });

  it('reports failed shared writes to every caller without publishing unfinished files', async () => {
    let failWrite!: () => void;
    vi.spyOn(conversionStorage, 'writeFileSafe').mockImplementation(() => new Promise((_resolve, reject) => { failWrite = () => reject(new Error('disk full')); }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('identical bytes'));
    const shared = context();
    const downloader = new AssetDownloader();
    const results = ['a.png', 'b.png'].map(name => downloader.downloadAsset('failed-write', `https://site.test/${name}`, 'image', undefined, shared));
    await tick();
    failWrite();
    expect(await Promise.all(results)).toEqual([null, null]);
    expect(shared.downloaded).toEqual([]);
    expect(shared.seenHashes.size).toBe(0);
    expect(shared.missing).toHaveLength(2);
  });

  it('releases permits after failures and validates limits before downloading', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('bad.png') ? new Response('missing', { status: 404 }) : new Response('good'));
    const downloader = new AssetDownloader();
    const result = await downloader.resolveAssets('failure', [asset('https://site.test/bad.png'), asset('https://site.test/good.png')], [], { downloadLimits: { maxConcurrent: 1 } });
    expect(result.missingAssets).toHaveLength(1);
    expect(result.downloadedAssets).toHaveLength(1);
    fetch.mockClear();
    await expect(downloader.resolveAssets('invalid', [], [], { downloadLimits: { maxConcurrent: 0 } })).rejects.toThrow('downloadLimits.maxConcurrent');
    expect(fetch).not.toHaveBeenCalled();
  });
});
