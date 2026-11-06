import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchThroughProxy, fetchProxyAsset } from '../src/proxies/proxy-fetch.js';
import { validateUrlForSsrf } from '../src/core/ssrf/ssrf-validator.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { conversionStorage } from '../src/generator/storage.js';
import { proxyService } from '../src/proxies/proxy.service.js';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
const id = 'proxy_routing_test';
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(validateUrlForSsrf).mockResolvedValue({ valid: true }); await conversionStorage.deleteConversion(id); });

async function withProxy(run: (url: string, requests: string[]) => Promise<void>) {
  const requests: string[] = [];
  const sockets = new Set<net.Socket>();
  const origin = http.createServer((request, response) => {
    requests.push(request.url || '');
    if (request.url?.includes('redirect')) { response.writeHead(302, { location: 'http://assets.example/main.css' }); response.end(); return; }
    if (request.url?.includes('private')) { response.writeHead(302, { location: 'http://127.0.0.1/secret' }); response.end(); return; }
    if (request.url?.includes('main.css')) { response.setHeader('content-type', 'text/css'); response.end('@import "nested.css"; .hero{display:flex;background-image:url(image.png)}'); return; }
    if (request.url?.includes('nested.css')) { response.setHeader('content-type', 'text/css'); response.end('.hero{padding:12px}'); return; }
    response.setHeader('content-type', 'image/png'); response.end(Buffer.from([137, 80, 78, 71]));
  });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const port = (origin.address() as net.AddressInfo).port;
  const proxy = http.createServer((request, response) => {
    const target = new URL(request.url!);
    const upstream = http.request({ hostname: '127.0.0.1', port, path: target.pathname + target.search, method: request.method }, result => {
      response.writeHead(result.statusCode!, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  proxy.on('connect', (_request, socket, head) => {
    const upstream = net.connect(port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    sockets.add(upstream); sockets.add(socket);
    upstream.on('error', () => socket.destroy());
  });
  for (const server of [origin, proxy]) server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`, requests); }
  finally { for (const socket of sockets) socket.destroy(); await Promise.all([origin, proxy].map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
}

describe('saved proxy routing', () => {
  it('requires a selected proxy when enabled and defaults to direct access', () => {
    expect(HtmlConversionOptionsSchema.parse({}).useProxy).toBe(false);
    expect(HtmlConversionOptionsSchema.safeParse({ useProxy: true }).success).toBe(false);
  });

  it('routes stylesheet imports, images and redirects through a real local proxy without direct fetch', async () => {
    await withProxy(async (proxyUrl, requests) => {
      const direct = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Direct access must not be used'));
      const asset = { originalUrl: 'http://assets.example/redirect', sourcePageUrl: 'http://assets.example/', type: 'stylesheet' as const, suggestedLocalName: 'main.css' };
      const result = await assetDownloader.resolveAssets(id, [asset], [], { proxyUrl });
      expect(result.missingAssets).toEqual([]);
      expect(result.consolidatedCss).toContain('display:flex');
      expect(result.consolidatedCss).toContain('padding:12px');
      expect(result.downloadedAssets.some(asset => asset.isImage)).toBe(true);
      expect(requests).toEqual(expect.arrayContaining(['/redirect', '/main.css', '/nested.css', '/image.png']));
      expect(direct).not.toHaveBeenCalled();
    });
  });

  it('validates proxy redirect destinations before requesting private addresses', async () => {
    await withProxy(async (proxyUrl, requests) => {
      vi.mocked(validateUrlForSsrf).mockImplementation(async url => ({ valid: !String(url).includes('127.0.0.1'), error: 'private address' }));
      await expect(fetchProxyAsset('http://assets.example/private', proxyUrl)).rejects.toThrow('Blocked proxied URL');
      expect(requests).toEqual(['/private']);
    });
  });

  it('does not fall back to direct access or leak proxy credentials when a proxy fails', async () => {
    const direct = vi.spyOn(globalThis, 'fetch');
    await expect(fetchThroughProxy('http://assets.example/', 'http://secret:password@127.0.0.1:1')).rejects.toThrow('no direct connection');
    expect(direct).not.toHaveBeenCalled();
  });

  it('does not expose SOCKS proxy credentials or fall back to direct access on failure', async () => {
    const direct = vi.spyOn(globalThis, 'fetch');
    await expect(fetchThroughProxy('http://assets.example/', 'socks5://secret:password@127.0.0.1:1')).rejects.toThrow('no direct connection');
    expect(direct).not.toHaveBeenCalled();
  });

  it('passes only server-resolved proxy credentials to HTML asset resolution, not exported HTML', async () => {
    const proxyUrl = 'http://secret:password@proxy.example:8080';
    vi.spyOn(proxyService, 'resolveUrl').mockResolvedValue(proxyUrl);
    const resolve = vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '.hero{display:flex}' });
    await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<div class="hero">Hello</div>' } }], options: HtmlConversionOptionsSchema.parse({ useProxy: true, proxyId: 'cjld2cjxh0000qzrmn831i7rn' }) });
    expect(resolve.mock.calls[0][3]?.proxyUrl).toBe(proxyUrl);
    expect(await conversionStorage.readFileSafe(id, 'index.html')).not.toContain('secret');
  });

  it('fails before asset downloads when an enabled saved proxy was deleted', async () => {
    vi.spyOn(proxyService, 'resolveUrl').mockResolvedValue(null);
    const resolve = vi.spyOn(assetDownloader, 'resolveAssets');
    await expect(exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<main>Hello</main>' } }], options: HtmlConversionOptionsSchema.parse({ useProxy: true, proxyId: 'cjld2cjxh0000qzrmn831i7rn' }) })).rejects.toThrow('selected proxy no longer exists');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('ignores stale proxy IDs when proxy routing is disabled', async () => {
    const resolveProxy = vi.spyOn(proxyService, 'resolveUrl');
    const resolve = vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '' });
    await exportStandaloneHtml({ conversionId: id, jobId: 'job', targetUrl: 'https://site.test/', domain: 'site.test', pages: [{ url: 'https://site.test/', rawData: { html: '<main>Hello</main>' } }], options: HtmlConversionOptionsSchema.parse({ useProxy: false, proxyId: 'cjld2cjxh0000qzrmn831i7rn' }) });
    expect(resolveProxy).not.toHaveBeenCalled();
    expect(resolve.mock.calls[0][3]?.proxyUrl).toBeUndefined();
  });
});
