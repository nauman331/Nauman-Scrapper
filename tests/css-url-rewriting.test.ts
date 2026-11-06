import { describe, it, expect, vi } from 'vitest';
import { conversionStorage } from '../src/generator/storage.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { staticValidator } from '../src/generator/validator/static-validator.js';
import postcss from 'postcss';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';
import { sanitizeGeneratedCss } from '../src/generator/css-sanitizer.js';

describe('Quoted source CSS URL rewriting', () => {
  it('keeps cursor asset URLs out of generated Tailwind class names', () => {
    const css = '.drag{cursor:url("/cloned-assets/images/grab.cur") 16 16,auto;color:red}';
    const result = convertDocumentsToTailwind([{id:'home',html:'<div class="drag" style=\'cursor:url("/cloned-assets/images/grab.cur") 16 16,auto\'>Drag</div>'}], css);
    expect(result.residualCss).toContain('cursor:url("/cloned-assets/images/grab.cur")');
    expect(result.documents[0].html).not.toContain('cursor-[');
    expect(result.stats.declarationsConverted).toBe(1);
  });
  it('downloads source-root images rather than assuming they exist in generated public', async () => {
    const id = 'css_root_asset_test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {headers:{'content-type':'image/png'}}));
    try {
      await conversionStorage.setupConversionWorkspace(id);
      const context = { downloaded: [] as import('../src/generator/types.js').DownloadedAsset[], missing: [] as string[], seenUrls: new Set<string>(), seenHashes: new Map(), assetRoot: 'cloned-assets' as const };
      const css = await assetDownloader.processAndRewriteCss(id, '.hero{background:url(/images/404.png)}', 'https://1.1.1.1/css/style.css', context);
      expect(fetchMock).toHaveBeenCalled();
      expect(String(fetchMock.mock.calls[0][0])).toBe('https://1.1.1.1/images/404.png');
      expect(css).toContain('/cloned-assets/images/');
      expect(context.downloaded).toHaveLength(1);
      await expect(fs.stat(path.join(conversionStorage.getProjectDir(id), context.downloaded[0].localPath))).resolves.toBeDefined();
    } finally { fetchMock.mockRestore(); await conversionStorage.deleteConversion(id); }
  });
  it('does not mistake an SVG data URL filter reference for a relative asset', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'css-noise-'));
    try {
      await fs.mkdir(path.join(root, 'app'));
      for (const file of ['package.json', 'tsconfig.json']) await fs.writeFile(path.join(root, file), '{}');
      await fs.writeFile(path.join(root, 'README.md'), 'fixture');
      await fs.writeFile(path.join(root, 'app/page.tsx'), 'export default function Page(){return <div/>}');
      await fs.writeFile(path.join(root, 'app/layout.tsx'), 'export default function Layout(){return <html><body/></html>}');
      await fs.writeFile(path.join(root, 'app/globals.css'), `.noise{background:url("data:image/svg+xml,%3Csvg%3E%3Crect style='filter:url(%23noise)'/%3E%3C/svg%3E")}`);
      const report = await staticValidator.validateProject(root, ['/'], [], []);
      expect(report.errors).toEqual([]);
      expect(report.passed).toBe(true);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('preserves SVG data URLs containing quotes, parentheses, and CSS functions', async () => {
    const css = `.icon{background-image:url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><path transform="translate(1,2)" d="M0 0"/></svg>');color:red}`;
    const context = { downloaded: [], missing: [], seenUrls: new Set<string>(), seenHashes: new Map() };
    const rewritten = await assetDownloader.processAndRewriteCss('test', css, 'https://example.com/style.css', context);
    const methods = assetDownloader as unknown as { localizeDownloadedAssetUrls(css: string, assets: []): string };
    const final = methods.localizeDownloadedAssetUrls(rewritten, []);
    expect(final).toBe(css);
    expect(() => postcss.parse(final)).not.toThrow();
    expect(() => sanitizeGeneratedCss(final, { strategy: 'tailwind' })).not.toThrow();
  });
  it('preserves hash references and rewrites complete quoted paths with parentheses', () => {
    const methods = assetDownloader as unknown as { localizeDownloadedAssetUrls(css: string, assets: []): string };
    const final = methods.localizeDownloadedAssetUrls('.a{filter:url("#shadow");background:url("/images/icon(2).png")}', []);
    expect(final).toContain('url("#shadow")');
    expect(final).toContain('url("/images/icon(2).png")');
    expect(() => postcss.parse(final)).not.toThrow();
  });
});
