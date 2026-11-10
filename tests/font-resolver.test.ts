import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitFontDefinitions, resolveGoogleFontDefinitions } from '../src/generator/assets/font-resolver.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';

afterEach(() => vi.restoreAllMocks());

describe('font resource preservation', () => {
  it('retains variable weights, italics, subsets, metric fallbacks and enclosing conditions', () => {
    const css = '@layer base{@media screen{@font-face{font-family:inter;src:url(inter.woff2);font-weight:100 900;font-style:italic;unicode-range:U+0000-00FF}body{font-family:inter}}}@font-face{font-family:"inter Fallback";src:local(Arial);size-adjust:107%;ascent-override:90%}';
    const split = splitFontDefinitions(css);
    expect(split.fontCss).toContain('@layer base{@media screen{@font-face');
    for (const value of ['100 900', 'italic', 'unicode-range', 'local(Arial)', 'size-adjust', 'ascent-override']) expect(split.fontCss).toContain(value);
    expect(split.fontCss).not.toContain('body');
    expect(split.utilityCss).toContain('body{font-family:inter}');
    expect(split.utilityCss).not.toContain('@font-face');
  });

  it('uses Google Inter with the original family alias, variable weights and local fallback intact', async () => {
    const resolve = vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: [], consolidatedCss: '@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;src:url(/fonts/google.woff2) format("woff2");unicode-range:U+0000-00FF}' });
    const result = await resolveGoogleFontDefinitions('font-test', '@font-face{font-family:inter;src:url(/fonts/source.woff2);font-weight:100 900}@font-face{font-family:"inter Fallback";src:local(Arial);size-adjust:107%}');
    expect(resolve.mock.calls[0][1][0].originalUrl).toContain('family=Inter:wght@100..900');
    expect(result.fontCss).toContain('font-family:"inter"');
    expect(result.fontCss).toContain('google.woff2');
    expect(result.fontCss).not.toContain('source.woff2');
    expect(result.fontCss).toContain('size-adjust:107%');
  });

  it('keeps the exact source font when Google is unavailable or incomplete', async () => {
    vi.spyOn(assetDownloader, 'resolveAssets').mockResolvedValue({ downloadedAssets: [], missingAssets: ['Font unavailable'], consolidatedCss: '' });
    const css = '@font-face{font-family:"Private Brand";src:url(/fonts/brand.woff2);font-weight:500;font-style:italic}';
    expect((await resolveGoogleFontDefinitions('font-test', css)).fontCss).toBe(css);
  });

  it('does not flatten conditional registrations or replace specialized metrics', async () => {
    const resolve = vi.spyOn(assetDownloader, 'resolveAssets');
    const css = '@media screen{@font-face{font-family:Inter;src:url(inter.woff2)}}@font-face{font-family:Inter;src:url(other.woff2);size-adjust:110%}';
    expect((await resolveGoogleFontDefinitions('font-test', css)).fontCss).toBe(css);
    expect(resolve).not.toHaveBeenCalled();
  });
});
