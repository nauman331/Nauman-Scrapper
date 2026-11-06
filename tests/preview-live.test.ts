import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SitePreviewService } from '../src/generator/preview.service.js';
import { conversionStorage } from '../src/generator/storage.js';
import { generatePackageJson, generateTsConfig, generateNextConfig, generatePostCssConfig } from '../src/generator/codegen/project-template.js';

describe.skipIf(process.env.RUN_PREVIEW_LIVE !== '1')('Actual local Next.js preview lifecycle', () => {
  it.each(['app', 'src/app'] as const)('installs, builds, serves %s, and stops its process', async (appRoot) => {
    const id = `preview_live_${appRoot.replace('/', '_')}_${Date.now()}`;
    const service = new SitePreviewService();
    await conversionStorage.setupConversionWorkspace(id);
    const write = (file: string, contents: string) => conversionStorage.writeFileSafe(id, file, contents);
    try {
      await write('package.json', generatePackageJson({ projectName: 'preview-fixture', domain: 'example.com', targetUrl: 'https://example.com', routes: [], pageCount: 1, cssStrategy: 'original' }));
      await write('tsconfig.json', generateTsConfig(appRoot === 'src/app' ? 'src' : undefined));
      await write('next.config.mjs', generateNextConfig('example.com'));
      await write('postcss.config.mjs', generatePostCssConfig('original'));
      await write(`${appRoot}/globals.css`, '.preview { color: red; & > span { font-weight: bold; } }');
      await write(`${appRoot}/layout.tsx`, "import './globals.css'; export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}");
      const pageRoute = appRoot === 'src/app' ? '/talk' : '/';
      await write(`${appRoot}${pageRoute === '/' ? '' : pageRoute}/page.tsx`, 'export default function Page(){return <div className="preview"><span>Built preview is working</span><ymaps className="map"><ymaps>Captured location</ymaps></ymaps></div>}');
      // A source environment file must never reach the preview copy.
      await write('.env.local', 'PREVIEW_FORBIDDEN_SECRET=do-not-copy');
      if (process.env.PREVIEW_SOURCE_PROJECT) {
        await fs.cp(path.resolve(process.env.PREVIEW_SOURCE_PROJECT), conversionStorage.getProjectDir(id), {
          recursive: true, filter: (file) => !['node_modules', '.next'].includes(path.basename(file)),
        });
      }
      service.start(id);
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline && !['READY', 'FAILED'].includes(service.get(id)!.status)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const record = service.get(id)!;
      expect(record.status, record.logs.join('\n')).toBe('READY');
      const response = await fetch(record.url!);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(process.env.PREVIEW_SOURCE_PROJECT ? '<!DOCTYPE html>' : 'Built preview is working');
      await service.stop(id);
      expect(service.get(id)?.status).toBe('STOPPED');
      await expect(fetch(record.url!, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
    } finally {
      await service.close();
      await conversionStorage.deleteConversion(id);
    }
  }, 360000);
});
