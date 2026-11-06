import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { ConversionService } from '../src/generator/conversion.service.js';
import { conversionStorage } from '../src/generator/storage.js';
import { jobRepository } from '../src/persistence/repositories/job.repository.js';
import { resultRepository } from '../src/persistence/repositories/result.repository.js';
import { ConversionOptionsSchema } from '../src/generator/types.js';
import { generatePageRoute } from '../src/generator/codegen/page-generator.js';
import { buildPageInventory } from '../src/generator/inventory/page-inventory.js';
import { staticValidator } from '../src/generator/validator/static-validator.js';
import { compileGeneratedCss } from '../src/generator/validator/css-compiler.js';

vi.mock('../src/core/ssrf/ssrf-validator.js', () => ({ validateUrlForSsrf: vi.fn(async () => ({ valid: true })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Read central-directory entries, including streamed ZIPs with data descriptors.
function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  expect(end).toBeGreaterThanOrEqual(0);
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    if (!name.endsWith('/')) files.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('Actual generated ZIP contract', () => {
  it.each(['original', 'tailwind'] as const)('packages src routes and localized assets in %s mode', async (cssStrategy) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generated-zip-'));
    vi.spyOn(conversionStorage, 'getConversionDir').mockImplementation((id) => path.join(root, id));
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>';
    const html = `<html><head><link rel="icon" href="/favicon.ico"/><style>@font-face{font-family:Fixture;src:url('/fixture.woff2')} .card{background:url('/picture.png');color:red}</style></head><body><header>Brand</header><main><section class="card"><h1>Hero</h1>${svg}<img src="/picture.png"/><p>Copy mentioning /images/not-an-asset.png and features/home stays unchanged.</p><div data-animation-type="lottie" data-src="/motion.json"></div></section><section><h2>Second</h2>${svg}</section></main><footer>Footer</footer></body></html>`;
    const pages = ['https://example.com/', 'https://example.com/about'].map((url) => ({ url, rawData: { html } }));
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue({ id: 'zip-job', domain: 'example.com', targetUrl: pages[0].url, name: 'ZIP' } as never);
    vi.spyOn(resultRepository, 'getResultsByJobId').mockResolvedValue({ items: pages, total: 2 } as never);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('.json') ? '{"v":"5.7","layers":[]}' : 'fixture-bytes-' + url, { headers: { 'content-type': url.endsWith('.json') ? 'application/json' : url.endsWith('.woff2') ? 'font/woff2' : 'image/png' } })));
    try {
      const service = new ConversionService();
      const record = await service.startConversion('zip-job', ConversionOptionsSchema.parse({ pages: pages.map((page) => page.url), cssStrategy, componentExtraction: 'deep', projectName: 'zip-fixture' }));
      await vi.waitFor(() => expect(['COMPLETED', 'FAILED']).toContain(service.getConversion(record.id)?.status), { timeout: 20000 });
      const result = service.getConversion(record.id)!;
      expect(result.errorMessage).toBeUndefined();
      expect(result.status).toBe('COMPLETED');
      const files = unzip(await fs.readFile(result.zipFilePath!));
      const names = [...files.keys()];
      for (const expected of ['src/app/page.tsx', 'src/app/about/page.tsx', 'src/app/layout.tsx', 'src/app/globals.css', 'src/lib/utils.ts', 'src/lib/site-config.ts', 'src/components/ui/LottieAsset.tsx']) expect(names).toContain(expected);
      expect(names.some((name) => /^(app|features|assets|components|lib)\//.test(name))).toBe(false);
      expect(names.some((name) => name.startsWith('src/data/'))).toBe(false);
      expect(names.some((name) => name.startsWith('src/components/cloned/page-1/sections/'))).toBe(true);
      expect(names.some((name) => name.startsWith('src/components/cloned/page-2/sections/'))).toBe(true);
      const icons = names.filter((name) => name.startsWith('src/components/icons/generated/'));
      expect(icons).toEqual(['src/components/icons/generated/GeneratedIcon1.tsx']);
      for (const category of ['images', 'fonts', 'icons', 'animations']) expect(names.some((name) => name.startsWith(`public/cloned-assets/${category}/`))).toBe(true);
      const code = names.filter((name) => name.endsWith('.tsx')).map((name) => files.get(name)!.toString()).join('\n');
      expect(code).toContain('Copy mentioning /images/not-an-asset.png and features/home stays unchanged.');
      const urls = (code + '\n' + files.get('src/app/globals.css')!.toString()).match(/\/cloned-assets\/(?:images|fonts|animations)\/[^"'\s<>;)]+/g) ?? [];
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(files.has(`public${url}`)).toBe(true);
      const config = JSON.parse(files.get('tsconfig.json')!.toString());
      expect(config.compilerOptions.paths['@/*']).toEqual(['./src/*']);
      const manifest = JSON.parse(files.get('package.json')!.toString());
      expect(manifest.dependencies.next).toMatch(/^\^16/);
      if (cssStrategy === 'tailwind') {
        expect(manifest.devDependencies.tailwindcss).toMatch(/^3\./);
        expect(files.get('tailwind.config.mjs')!.toString()).toContain('./src/components/');
      }
      // Validate the actual extracted ZIP, rather than trusting workspace validation.
      const extracted = path.join(root, 'extracted');
      for (const [name, contents] of files) {
        await fs.mkdir(path.dirname(path.join(extracted, name)), { recursive: true });
        await fs.writeFile(path.join(extracted, name), contents);
      }
      const report = await staticValidator.validateProject(extracted, ['/', '/about'], names.filter((name) => name.startsWith('public/')).map((name) => name.slice(6)), [], cssStrategy);
      expect(report.errors).toEqual([]);
      expect(report.passed).toBe(true);
      await compileGeneratedCss(extracted, cssStrategy);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 30000);

  it('uses readable numeric section collision suffixes without breaking legacy callers', () => {
    const html = '<section><h1>First</h1></section><section><h1>Second</h1></section>';
    const item = buildPageInventory('fixture', 'https://example.com/', 'example.com', [{ url: 'https://example.com/', rawData: { html } }]).pages[0];
    const sections = ['<section><h1>First</h1></section>', '<section><h1>Second</h1></section>'].map((html) => ({ name: 'Hero', html }));
    const input = { item, rawContentHtml: html, sections, isRoot: true };
    const modern = generatePageRoute({ ...input, sourceRoot: 'src', pageNamespace: 'page-1' });
    expect(modern.generatedComponents?.map((component) => component.componentName).sort()).toEqual(['Hero', 'Hero2']);
    expect(generatePageRoute({ ...input, sourceRoot: 'src', pageNamespace: 'page-1' })).toEqual(modern);
    const legacy = generatePageRoute(input);
    expect(legacy.filePath).toBe('app/page.tsx');
    expect(legacy.generatedComponents?.every((component) => component.filePath.startsWith('features/'))).toBe(true);
  });
});
