import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetDownloader, type AssetResolutionOptions } from '../src/generator/assets/asset-downloader.js';
import { conversionStorage } from '../src/generator/storage.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({
  validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }),
}));

afterEach(() => vi.restoreAllMocks());

const sourceUrl = 'https://source.test/page';
const css = '@font-face{src:url(%22/fonts/demo.woff2%22)}.hero{background:url("/images/hero(large).png")}';

const modes: Array<{ name: string; options: AssetResolutionOptions; root: string; fetches: number }> = [
  { name: 'legacy defaults', options: {}, root: '', fetches: 0 },
  { name: 'legacy explicit public URLs', options: { generatedPublicAssetUrls: true }, root: '', fetches: 0 },
  { name: 'standalone HTML source URLs', options: { generatedPublicAssetUrls: false }, root: '', fetches: 2 },
  { name: 'Next.js cloned assets', options: { assetRoot: 'cloned-assets' }, root: 'cloned-assets/', fetches: 2 },
  { name: 'combined source options', options: { assetRoot: 'cloned-assets', generatedPublicAssetUrls: false }, root: 'cloned-assets/', fetches: 2 },
  { name: 'cloned root overrides public URL shortcut', options: { assetRoot: 'cloned-assets', generatedPublicAssetUrls: true }, root: 'cloned-assets/', fetches: 2 },
];

describe('asset export mode isolation', () => {
  it.each(modes)('preserves $name', async ({ options, root, fetches }) => {
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-asset-path');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      return new Response(url.endsWith('.woff2') ? 'font bytes' : 'image bytes', {
        headers: { 'content-type': url.endsWith('.woff2') ? 'font/woff2' : 'image/png' },
      });
    });
    const result = await new AssetDownloader().resolveAssets('mode-isolation', [], [{ css, sourceUrl }], options);
    expect(fetch).toHaveBeenCalledTimes(fetches);
    expect(result.missingAssets).toEqual([]);
    if (!fetches) {
      expect(result.consolidatedCss).toContain('url("/fonts/demo.woff2")');
      expect(result.consolidatedCss).toContain('url("/images/hero(large).png")');
      expect(write).not.toHaveBeenCalled();
      return;
    }
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://source.test/fonts/demo.woff2',
      'https://source.test/images/hero(large).png',
    ]);
    expect(result.downloadedAssets).toHaveLength(2);
    for (const asset of result.downloadedAssets) {
      expect(asset.publicUrl).toMatch(new RegExp(`^/${root}(fonts|images)/`));
      expect(asset.localPath).toBe(`public${asset.publicUrl}`);
      expect(result.consolidatedCss).toContain(`url("${asset.publicUrl}")`);
      expect(write).toHaveBeenCalledWith('mode-isolation', asset.localPath, expect.any(Buffer));
    }
  });

  it('preserves SVG data, blobs and fragments through all CSS rewrite passes', async () => {
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-asset-path');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const svg = 'url("data:image/svg+xml,%3Csvg%3E%3Cpath transform=\'rotate(180 12 12)\' fill=\'%23fff\'/%3E%3C/svg%3E")';
    const source = `.badge{background:${svg}}.a{mask:url("#clip")}.b{background:url("blob:https://source.test/a")}`;
    const result = await new AssetDownloader().resolveAssets('mode-isolation', [], [{ css: source, sourceUrl }], { assetRoot: 'cloned-assets', generatedPublicAssetUrls: false });
    expect(result.consolidatedCss).toBe(source);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps nested stylesheet and media downloads in the selected namespace', async () => {
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock-asset-path');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('main.css')) return new Response('@import "nested.css" screen; .hero{background:url("/images/hero.png")}', { headers: { 'content-type': 'text/css' } });
      if (url.endsWith('nested.css')) return new Response('@font-face{src:url("/fonts/demo.woff2")}', { headers: { 'content-type': 'text/css' } });
      return new Response(url, { headers: { 'content-type': url.endsWith('.woff2') ? 'font/woff2' : 'image/png' } });
    });
    const result = await new AssetDownloader().resolveAssets('mode-isolation', [{
      originalUrl: 'https://source.test/css/main.css', sourcePageUrl: sourceUrl,
      type: 'stylesheet', suggestedLocalName: 'main.css',
    }], [], { assetRoot: 'cloned-assets' });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.consolidatedCss).toContain('@media screen');
    expect(result.consolidatedCss).not.toContain('@import');
    expect(result.missingAssets).toEqual([]);
    expect(result.downloadedAssets).toHaveLength(3);
    for (const asset of result.downloadedAssets) {
      expect(asset.publicUrl).toMatch(/^\/cloned-assets\/(fonts|images|css)\//);
      expect(write).toHaveBeenCalledWith('mode-isolation', `public${asset.publicUrl}`, expect.any(Buffer));
    }
  });
});
