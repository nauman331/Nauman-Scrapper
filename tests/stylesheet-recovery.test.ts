import { afterEach, expect, it, vi } from 'vitest';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { conversionStorage } from '../src/generator/storage.js';
import { sanitizeGeneratedCss } from '../src/generator/css-sanitizer.js';
import { validateUrlForSsrf } from '../src/core/ssrf/ssrf-validator.js';
vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
const id = 'stylesheet_recovery_test';
const asset = { originalUrl: 'https://site.test/main.css', sourcePageUrl: 'https://site.test/', type: 'stylesheet' as const, suggestedLocalName: 'main.css' };
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(validateUrlForSsrf).mockResolvedValue({ valid: true }); await conversionStorage.deleteConversion(id); });
it('removes decoded charset metadata before media wrapping and nested imports without losing rules', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async request => String(request).endsWith('nested.css')
    ? new Response('\uFEFF@charset "UTF-8"; .imported{color:red}')
    : new Response('@charset "UTF-8"; @import "nested.css" screen and (min-width:600px); .hero{display:flex}'));
  const result = await assetDownloader.resolveAssets(id, [asset], [], { cssSources: [{ asset, sourceUrl: asset.sourcePageUrl, media: 'screen' }] });
  expect(result.consolidatedCss).not.toContain('@charset');
  expect(result.consolidatedCss).toContain('.hero{display:flex}');
  expect(result.consolidatedCss).toContain('.imported{color:red}');
  expect(result.consolidatedCss).toContain('@media screen');
  expect(() => sanitizeGeneratedCss(result.consolidatedCss, { strategy: 'tailwind' })).not.toThrow();
  expect(result.missingAssets).toEqual([]);
});
it('does not conceal genuinely malformed nested charset directives', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('@media screen{@charset "UTF-8";.hero{color:red}}'));
  const result = await assetDownloader.resolveAssets(id, [asset]);
  expect(() => sanitizeGeneratedCss(result.consolidatedCss, { strategy: 'tailwind' })).toThrow('invalid nested or block @charset');
});
it('recovers from transient fetch failures without losing CSS', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })).mockResolvedValueOnce(new Response('.hero{display:flex}', { headers: { 'content-type': 'text/css' } }));
  const result = await assetDownloader.resolveAssets(id, [asset]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.consolidatedCss).toContain('display:flex');
  expect(result.missingAssets).toEqual([]);
});
it('does not retry permanent 404s and reports underlying network errors after bounded retries', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
  expect((await assetDownloader.resolveAssets(id, [asset])).missingAssets.join(' ')).toContain('HTTP 404');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', message: 'DNS lookup failed' } }));
  const result = await assetDownloader.resolveAssets(id, [asset]);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(result.missingAssets.join(' ')).toContain('ENOTFOUND');
});
it('retries imported CSS and resolves relative URLs against a validated redirect destination', async () => {
  let importedAttempts = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async request => {
    const url = String(request);
    if (url === asset.originalUrl) return new Response('', { status: 302, headers: { location: '/styles/main.css' } });
    if (url.endsWith('/styles/main.css')) return new Response('@import "nested.css"; .hero{display:grid}');
    if (url.endsWith('/styles/nested.css')) {
      if (++importedAttempts === 1) return new Response('', { status: 503 });
      return new Response('.hero{padding:12px}');
    }
    throw new Error('Unexpected URL ' + url);
  });
  const result = await assetDownloader.resolveAssets(id, [asset]);
  expect(fetch.mock.calls.map(([url]) => String(url))).toContain('https://site.test/styles/nested.css');
  expect(result.consolidatedCss).toContain('padding:12px');
  expect(result.missingAssets).toEqual([]);
});
it('blocks private redirects before fetching and rejects HTML access challenges', async () => {
  vi.mocked(validateUrlForSsrf).mockImplementation(async url => ({ valid: !String(url).includes('127.0.0.1'), error: 'private address' }));
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private.css' } }));
  expect((await assetDownloader.resolveAssets(id, [asset])).missingAssets.join(' ')).toContain('Blocked stylesheet URL');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockResolvedValue(new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }));
  expect((await assetDownloader.resolveAssets(id, [asset])).missingAssets.join(' ')).toContain('received HTML');
  expect(fetch).toHaveBeenCalledTimes(1);
});
