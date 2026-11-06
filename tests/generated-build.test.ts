import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import postcss from 'postcss';
import { sanitizeGeneratedCss } from '../src/generator/css-sanitizer.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { domAnalyzer } from '../src/generator/analyzer/dom-analyzer.js';
import { generatePageRoute } from '../src/generator/codegen/page-generator.js';
import { generateRootLayout } from '../src/generator/codegen/layout-generator.js';
import { buildPageInventory } from '../src/generator/inventory/page-inventory.js';
import { generatePackageJson, generateTsConfig, generateNextConfig, generatePostCssConfig, generateTailwindConfig } from '../src/generator/codegen/project-template.js';

const exec = promisify(execFile);
// Opt-in network/build integration; ordinary tests never install dependencies.
describe.skipIf(process.env.RUN_GENERATED_BUILD !== '1')('Real generated Next.js build', () => {
  it('builds modular pages with nested source CSS in original and Tailwind modes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scraper-next-build-'));
    const storedProject = process.env.GENERATED_SOURCE_PROJECT;
    const html = '<html><body><header>Brand</header><main><section class="card"><h1>Snapshot</h1><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg></section><aside>Sidebar</aside></main><footer>Footer</footer></body></html>';
    const item = buildPageInventory('build', 'https://example.com/', 'example.com', [{ url: 'https://example.com/', rawData: { html } }]).pages[0];
    const structure = domAnalyzer.analyzePage(html, item.url, item.url);
    const page = generatePageRoute({ item, rawContentHtml: html, bodyContentHtml: structure.bodyContentHtml, sections: structure.sections, isRoot: true, sourceRoot: 'src', pageNamespace: 'page-1' });
    const write = async (file: string, contents: string) => {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), contents);
    };
    const npm = (args: string[]) => exec(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: root, shell: process.platform === 'win32', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    try {
      await write('package.json', generatePackageJson({ projectName: 'build-fixture', domain: 'example.com', targetUrl: item.url, routes: [], pageCount: 1, cssStrategy: 'tailwind' }));
      await write('tsconfig.json', generateTsConfig('src'));
      await write('next-env.d.ts', '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
      await write('next.config.mjs', generateNextConfig('example.com'));
      await write('src/app/layout.tsx', generateRootLayout({ siteTitle: 'Fixture', hasHeader: false, hasFooter: false, hasNavigation: false, preserveSourceLayout: true }));
      await write(page.filePath, page.code);
      for (const component of page.generatedComponents || []) await write(component.filePath, component.code);
      for (const asset of page.svgAssets) await write(asset.filePath, asset.code);
      await write('tailwind.config.mjs', generateTailwindConfig('src'));
      let sourceCss: string | undefined;
      if (storedProject) {
        const stored = path.resolve(storedProject);
        const appRoot = await fs.stat(path.join(stored, 'src/app')).then(() => 'src/app', () => 'app');
        sourceCss = await fs.readFile(path.join(stored, appRoot, 'globals.css'), 'utf8');
        const parsed = postcss.parse(sourceCss);
        parsed.walkAtRules('tailwind', (rule) => { rule.remove(); });
        sourceCss = parsed.toString();
        await fs.cp(path.join(stored, 'public'), path.join(root, 'public'), { recursive: true });
      }
      await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
      for (const strategy of ['original', 'tailwind'] as const) {
        await write('postcss.config.mjs', generatePostCssConfig(strategy));
        const css = sourceCss === undefined
          ? '@layer source-theme, source-utilities; @layer source-utilities { .card { padding: 1rem; & > h1 { color: red; } } }'
          : sanitizeGeneratedCss(sourceCss, { strategy });
        await write('src/app/globals.css', `${strategy === 'tailwind' ? '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' : ''}${css}`);
        const result = await npm(['run', 'check']);
        expect(result.stdout).toContain('next build');
        console.log(`Generated ${strategy} build passed`);
      }
    } catch (error) {
      const commandError = error as Error & { stdout?: string; stderr?: string };
      throw new Error(`${commandError.message}\n${commandError.stdout || ''}\n${commandError.stderr || ''}`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 600000);
});
