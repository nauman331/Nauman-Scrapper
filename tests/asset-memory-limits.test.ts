import { afterEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import { AssetCollector } from '../src/generator/assets/asset-collector.js';
import { AssetDownloader, CssBudgetExceededError } from '../src/generator/assets/asset-downloader.js';
import { cssUrlPattern, unquoteCssUrl } from '../src/generator/assets/css-urls.js';
import { conversionStorage } from '../src/generator/storage.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn().mockResolvedValue({ valid: true }) }));
afterEach(() => vi.restoreAllMocks());
const base = 'https://source.example/css/site.css';
const data = 'data:image/svg+xml,%3Csvg%3E%3Cpath transform=%22translate(1,2)%22/%3E%3C/svg%3E';
const context = () => ({ downloaded: [], missing: [], seenUrls: new Set<string>(), seenHashes: new Map() });
const mockCss = (css: string | ((url: string) => string)) => vi.spyOn(globalThis, 'fetch').mockImplementation(async url => new Response(typeof css === 'string' ? css : css(String(url)), { headers: { 'content-type': 'text/css' } }));

describe('asset URL normalization before resolution', () => {
  it('matches whole escaped-quoted data SVG URLs including literal parentheses', async () => {
    const raw = String.raw`\"${data}\"`;
    const css = `.icon{background:url(${raw});color:red}`;
    expect([...css.matchAll(cssUrlPattern())][0][1]).toBe(raw);
    expect(unquoteCssUrl(raw)).toBe(data);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await new AssetDownloader().resolveAssets('escaped-data', [], [css]);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.missingAssets).toEqual([]);
    expect(result.consolidatedCss).toContain(`url("${data}")`);
    expect(() => postcss.parse(result.consolidatedCss)).not.toThrow();
    expect(new AssetCollector().collectAssets(`<div style='${css}'></div>`, base)).toEqual([]);
  });

  it.each([
    '%22data:image/svg+xml,%3Csvg/%3E%22',
    '%2522data:image/svg+xml,%253Csvg/%253E%2522',
    'https://source.example/css/%22data:image/svg+xml,%3Csvg/%3E%22',
    'https://source.example/css/%2522data:image/svg+xml,%253Csvg/%253E%2522',
    '&quot;data:image/svg+xml,%3Csvg/%3E&quot;',
  ])('does not download encoded quoted data URL %s', async raw => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const css = `.icon{background:url(${raw})}`;
    const result = await new AssetDownloader().resolveAssets('encoded-data', [], [css]);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.consolidatedCss).toMatch(/url\("data:image\/svg\+xml,/);
    expect(result.consolidatedCss).not.toContain('https://source.example');
    expect(() => postcss.parse(result.consolidatedCss)).not.toThrow();
    expect(new AssetCollector().collectAssets(`<div style='${css}'></div>`, base)).toEqual([]);
  });

  it('preserves valid encoded data payloads and embedded filter references exactly', async () => {
    const css = `.icon{background:url("data:image/svg+xml,%3Csvg%3E%3Crect style='filter:url(%23noise)'/%3E%3C/svg%3E")}`;
    expect(await new AssetDownloader().processAndRewriteCss('valid-data', css, base, context())).toBe(css);
  });
});

describe('cumulative CSS processing budgets', () => {
  it('caps recursive imports with unique URLs before fetching beyond the depth limit', async () => {
    const fetch = mockCss(url => `@import "${Number(new URL(url).pathname.match(/\d+/)?.[0] ?? 0) + 1}.css";`);
    await expect(new AssetDownloader().resolveAssets('depth', [], [{ css: '@import "0.css";', sourceUrl: base }], { cssLimits: { maxImportDepth: 2 } })).rejects.toThrow(/maxImportDepth=2.*cssLimits.maxImportDepth/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caps import fanout including repeated URLs, not only unique downloads', async () => {
    const fetch = mockCss('');
    await expect(new AssetDownloader().resolveAssets('count', [], [{ css: '@import "a.css";@import "a.css";@import "b.css";', sourceUrl: base }], { cssLimits: { maxImportCount: 2 } })).rejects.toThrow(/maxImportCount=2/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares input budgets across inline sheets and measures UTF-8 bytes', async () => {
    const css = '.x{content:"é"}';
    await expect(new AssetDownloader().resolveAssets('input', [], [css, css], { cssLimits: { maxInputBytes: Buffer.byteLength(css) * 2 - 1 } })).rejects.toThrow(/maxInputBytes/);
  });

  it('limits streamed imported bytes and rethrows budget errors through stylesheet catches', async () => {
    const cancel = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).endsWith('root.css')
      ? new Response('@import "child.css";', { headers: { 'content-type': 'text/css' } })
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40)); }, cancel }), { headers: { 'content-type': 'text/css' } }));
    const write = vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue('mock');
    const assets = new AssetCollector().collectAssets('<link rel="stylesheet" href="root.css">', base);
    await expect(new AssetDownloader().resolveAssets('stream-budget', assets, [], { cssLimits: { maxInputBytes: 30 } })).rejects.toBeInstanceOf(CssBudgetExceededError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects oversized declared CSS bodies without reading or retrying', async () => {
    const cancel = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/css', 'content-length': '100' } }));
    const assets = new AssetCollector().collectAssets('<link rel="stylesheet" href="root.css">', base);
    await expect(new AssetDownloader().resolveAssets('declared-budget', assets, [], { cssLimits: { maxInputBytes: 20 } })).rejects.toThrow(/maxInputBytes=20/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('caps cumulative output from recursive import copying and media wrappers', async () => {
    const fetch = mockCss('.a{color:red}');
    await expect(new AssetDownloader().resolveAssets('output', [], [{ css: '@import "a.css" screen;', sourceUrl: base }], { cssLimits: { maxOutputBytes: 40 } })).rejects.toThrow(/maxOutputBytes=40/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('supports small explicit limits and removes finite import cycles', async () => {
    mockCss('@import "a.css";.a{color:red}');
    const result = await new AssetDownloader().resolveAssets('finite', [], [{ css: '@import "a.css";', sourceUrl: base }], { cssLimits: { maxImportCount: 3, maxImportDepth: 3, maxInputBytes: 100, maxOutputBytes: 200 } });
    expect(result.consolidatedCss).toBe('.a{color:red}');
    expect(result.missingAssets).toEqual([]);
  });
});
