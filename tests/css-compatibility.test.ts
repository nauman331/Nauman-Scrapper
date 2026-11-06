import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import postcss, { type Plugin } from 'postcss';
import { sanitizeGeneratedCss } from '../src/generator/css-sanitizer.js';
import { staticValidator } from '../src/generator/validator/static-validator.js';

const source = `@layer theme, base, components, utilities;
@layer base { body { margin: 0; } }
@layer components { .card { color: red; } @layer utilities { .nested { display: block; } } }
@layer components.buttons, utilities.responsive;
@layer components.buttons { .button { border: 0; } }
@layer theme { :root { --color-brand: #123456; } }
@layer utilities { .native { color: var(--color-brand); } }`;

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function project(css: string, strategy: 'original' | 'tailwind' = 'original'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'css-compatibility-'));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  const files: Record<string, string> = {
    'package.json': strategy === 'tailwind' ? JSON.stringify({ devDependencies: { tailwindcss: '^3.4.0', postcss: '^8.0.0' } }) : '{}',
    'tsconfig.json': '{}',
    'README.md': 'test fixture',
    'app/layout.tsx': 'export default function Layout({children}: {children: React.ReactNode}) { return <html><body>{children}</body></html>; }',
    'app/page.tsx': 'export default function Page() { return <main>Home</main>; }',
    'app/globals.css': css,
  };
  if (strategy === 'tailwind') {
    files['tailwind.config.mjs'] = 'export default {content: []};';
    files['postcss.config.mjs'] = 'export default {plugins: {tailwindcss: {}}};';
  }
  await Promise.all(Object.entries(files).map(([file, content]) => fs.writeFile(path.join(root, file), content)));
  return root;
}

function layers(css: string): string[] {
  const result: string[] = [];
  postcss.parse(css).walkAtRules('layer', (rule) => { result.push(rule.params); });
  return result;
}

const directives = [
  '@tailwind utilities;', '@apply flex;', '@theme { --color-brand: red; }',
  '@utility custom { color: red; }', '@config "./tailwind.config.js";',
  '@plugin "plugin";', '@reference "tailwindcss";', '@custom-variant dark (&:where(.dark *));',
];

describe('Source CSS compatibility', () => {
  it('preserves native v4 cascade order and namespaces every v3 reserved layer reference', () => {
    const css = sanitizeGeneratedCss(source, { strategy: 'tailwind' });
    expect(layers(css)).toEqual([
      'theme, source-base, source-components, source-utilities', 'source-base',
      'source-components', 'source-utilities', 'source-components.buttons, source-utilities.responsive',
      'source-components.buttons', 'theme', 'source-utilities',
    ]);
    const root = postcss.parse(css);
    const nested = root.nodes.find((node) => node.type === 'atrule' && node.params === 'source-components');
    expect(nested?.type === 'atrule' && nested.nodes?.some((node) => node.type === 'atrule' && node.params === 'source-utilities')).toBe(true);
    expect(css).toContain('--color-brand: #123456');
    expect(css).toContain('.native');
    expect(sanitizeGeneratedCss(css, { strategy: 'tailwind' })).toBe(css);
  });

  it('preserves original native layer names, statements, nesting and ordering', () => {
    const css = sanitizeGeneratedCss(source, { strategy: 'original' });
    expect(layers(css)).toEqual(layers(source));
    expect(css).not.toContain('source-base');
    expect(css).toContain('@layer components.buttons, utilities.responsive;');
  });

  it('preserves empty named layers and anonymous layers without reserving Tailwind names', () => {
    const css = sanitizeGeneratedCss('@layer base {} @layer { .a { color: red } }', { strategy: 'tailwind' });
    expect(layers(css)).toEqual(['source-base', '']);
  });

  it('handles comments, escaped identifiers and qualified layer components consistently', () => {
    const css = sanitizeGeneratedCss(String.raw`@layer base /* utilities */, my-base, components.base, \75 tilities; @layer \62 ase { .a {color:red} }`, { strategy: 'tailwind' });
    expect(layers(css)).toEqual(['source-base , my-base, source-components.source-base, source-utilities', 'source-base']);
    expect(css).toContain('/* utilities */');
  });

  it('removes duplicate charsets and relocates the single charset before CSS', () => {
    const css = sanitizeGeneratedCss('/* source A */ @charset "UTF-8"; .a { color: red } @charset "UTF-8"; .b { color: blue }');
    const root = postcss.parse(css);
    expect(root.first?.type === 'atrule' && root.first.name).toBe('charset');
    const charsets: string[] = [];
    root.walkAtRules('charset', (rule) => { charsets.push(rule.params); });
    expect(charsets).toEqual(['"UTF-8"']);
    expect(css).toContain('.a');
    expect(css).toContain('.b');
  });

  it('rejects nested charset rather than silently deleting it', () => {
    expect(() => sanitizeGeneratedCss('@media all { @charset "UTF-8"; }')).toThrow(/invalid nested.*@charset/);
  });

  it.each(['.a { color: red;', '/* unclosed', '.a { content: "unclosed; }', '}', 'garbage'])('fails closed for unrecoverable malformed CSS: %s', (css) => {
    expect(() => sanitizeGeneratedCss(css)).toThrow(/Cannot sanitize source CSS.*Compile the source stylesheet/);
  });

  it('does not silently discard malformed template rules', () => {
    expect(() => sanitizeGeneratedCss('.{{selector}} { color:red')).toThrow(/unclosed template rule block/);
    expect(() => sanitizeGeneratedCss('.{{selector}}')).toThrow(/without a closing delimiter/);
  });

  it('still recovers bounded malformed rules while preserving neighbors and quoted braces', () => {
    const css = sanitizeGeneratedCss('.before{color:red}.broken{color red;content:"}"}.after{display:block}');
    expect(css).toContain('.before');
    expect(css).toContain('.after');
    expect(css).not.toContain('.broken');
    expect(() => postcss.parse(css)).not.toThrow();
  });

  it('fails closed when malformed rule recovery exceeds its bounded retry limit', () => {
    expect(() => sanitizeGeneratedCss(Array.from({ length: 21 }, (_, i) => `.bad${i}{color red}`).join(''))).toThrow(/Cannot sanitize source CSS/);
  });

  it.each(directives)('rejects uncompiled source directive in either mode: %s', (directive) => {
    for (const strategy of ['original', 'tailwind'] as const) {
      expect(() => sanitizeGeneratedCss(`\n${directive}`, { strategy })).toThrow(/source CSS at 2:1: unsupported uncompiled @.*Compile the source stylesheet/);
    }
  });

  it('rejects directives before malformed recovery could silently discard them', () => {
    expect(() => sanitizeGeneratedCss('.bad { color red; @apply flex; }')).toThrow(/unsupported uncompiled @apply/);
  });

  it('does not confuse comments or quoted content with source directives', () => {
    const css = '/* @theme {} @tailwind utilities; */ .a { content: "@apply flex;"; --text: "@plugin"; }';
    expect(sanitizeGeneratedCss(css)).toBe(css);
  });
});

describe('Final generated CSS and project validation', () => {
  it('accepts native original layers with existing minimal package fixtures', async () => {
    const root = await project(sanitizeGeneratedCss(source));
    expect((await staticValidator.validateProject(root, ['/'], [], [])).passed).toBe(true);
  });

  it('accepts only generated top-level Tailwind directives alongside namespaced source layers', async () => {
    const css = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${sanitizeGeneratedCss(source, { strategy: 'tailwind' })}`;
    const root = await project(css, 'tailwind');
    expect((await staticValidator.validateProject(root, ['/'], [], [], 'tailwind')).passed).toBe(true);
  });

  it.each(directives)('rejects source directives during final original validation: %s', async (directive) => {
    const root = await project(directive);
    const report = await staticValidator.validateProject(root, ['/'], [], []);
    expect(report.passed).toBe(false);
    expect(report.syntaxValid).toBe(false);
    expect(report.errors.some((error) => error.includes('Incompatible source CSS directive'))).toBe(true);
  });

  it.each(['@media all { @tailwind utilities; }', '@tailwind screens;', '@tailwind utilities { .a { color:red } }', '@theme { --x:red }', '.a { @apply flex; }'])('rejects nested or incompatible Tailwind-mode directives: %s', async (directive) => {
    const root = await project(`@tailwind utilities; ${directive}`, 'tailwind');
    const report = await staticValidator.validateProject(root, ['/'], [], [], 'tailwind');
    expect(report.passed).toBe(false);
    expect(report.errors.some((error) => error.includes('Incompatible source CSS directive'))).toBe(true);
  });

  it('does not mistake a commented directive for a generated utilities directive', async () => {
    const root = await project('/* @tailwind utilities; */ .a { content:"@tailwind utilities;" }', 'tailwind');
    const report = await staticValidator.validateProject(root, ['/'], [], [], 'tailwind');
    expect(report.passed).toBe(false);
    expect(report.errors.some((error) => error.includes('requires generated top-level'))).toBe(true);
  });

  it('rejects missing relative CSS imports and accepts actual local stylesheets', async () => {
    const root = await project('@import "./missing.css";');
    const missing = await staticValidator.validateProject(root, ['/'], [], []);
    expect(missing.importReferencesValid).toBe(false);
    expect(missing.errors).toContainEqual(expect.stringContaining('Broken CSS import'));
    await fs.writeFile(path.join(root, 'app', 'missing.css'), '.a {color:red}');
    expect((await staticValidator.validateProject(root, ['/'], [], [])).passed).toBe(true);
  });

  it('marks malformed final CSS as syntax invalid', async () => {
    const root = await project('.a { color:red');
    const report = await staticValidator.validateProject(root, ['/'], [], []);
    expect(report.syntaxValid).toBe(false);
    expect(report.errors.some((error) => /CSS syntax error in app\/globals.css:1:1/u.test(error))).toBe(true);
  });

  it('resolves relative imports, side-effect CSS, index imports and NodeNext .js source imports', async () => {
    const root = await project('');
    await fs.mkdir(path.join(root, 'components', 'widget'), { recursive: true });
    await fs.writeFile(path.join(root, 'components', 'widget', 'index.tsx'), 'export default function Widget() { return <div/>; }');
    await fs.writeFile(path.join(root, 'app', 'helper.ts'), 'export const value = 1;');
    await fs.writeFile(path.join(root, 'app', 'page.tsx'), 'import "./globals.css"; import Widget from "../components/widget"; export {value} from "./helper.js"; export default function Page() { return <Widget/>; }');
    expect((await staticValidator.validateProject(root, ['/'], [], [])).importReferencesValid).toBe(true);
  });

  it('rejects missing relative imports, directory-only imports and literal dynamic imports', async () => {
    const root = await project('');
    await fs.mkdir(path.join(root, 'app', 'empty'));
    await fs.writeFile(path.join(root, 'app', 'page.tsx'), 'import "./missing.css"; import Widget from "./empty"; export {value} from "./missing.js"; const x = import("./absent"); export default function Page() { return <main/>; }');
    const report = await staticValidator.validateProject(root, ['/'], [], []);
    expect(report.importReferencesValid).toBe(false);
    expect(report.errors.filter((error) => error.startsWith('Broken import'))).toHaveLength(4);
  });

  it('ignores module reference lookalikes in comments and quoted text', async () => {
    const root = await project('');
    await fs.writeFile(path.join(root, 'app', 'page.tsx'), '// import X from "./missing"\nconst text = `from "@/absent"`; export default function Page() { return <main>{text}</main>; }');
    expect((await staticValidator.validateProject(root, ['/'], [], [])).importReferencesValid).toBe(true);
  });

  it('checks actual public asset existence when downloaded assets are known, including queries and fragments', async () => {
    const root = await project('.a {background:url("/images/hero.png?v=1#x")} .b {background:url(/images/missing.png)}');
    await fs.mkdir(path.join(root, 'public', 'images'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'images', 'hero.png'), 'fixture');
    const report = await staticValidator.validateProject(root, ['/'], ['/images/hero.png', '/images/missing.png'], []);
    expect(report.assetReferencesValid).toBe(false);
    expect(report.errors.filter((error) => error.includes('Missing local CSS asset'))).toEqual([
      expect.stringContaining('/images/missing.png'),
    ]);
  });

  it('keeps unknown asset fixtures permissive and ignores external, data and fragment URLs', async () => {
    const root = await project('.a {background:url(/images/unknown.png)}');
    expect((await staticValidator.validateProject(root, ['/'], [], [])).passed).toBe(true);
    await fs.writeFile(path.join(root, 'app', 'globals.css'), '.a{a:url(https://example.com/x);b:url(//example.com/x);c:url(data:image/png;base64,AAAA);d:url(#icon)}');
    expect((await staticValidator.validateProject(root, ['/'], ['/images/known.png'], [])).passed).toBe(true);
  });
});

// The repository does not currently install Tailwind. Enable real v3 compiler
// regression coverage automatically if an existing installation is available;
// never install a compiler or mutate dependencies from a test.
const require = createRequire(import.meta.url);
let tailwindV3: ((config: Record<string, unknown>) => Plugin) | undefined;
try {
  const metadata = require('tailwindcss/package.json') as { version: string };
  if (metadata.version.startsWith('3.')) tailwindV3 = require('tailwindcss') as typeof tailwindV3;
} catch { /* Optional existing compiler, no installation required. */ }

it.skipIf(!tailwindV3)('compiles namespaced native v4 layers with generated Tailwind v3 utilities without losing source rules', async () => {
  const css = `@tailwind base; @tailwind components; @tailwind utilities; ${sanitizeGeneratedCss(source, { strategy: 'tailwind' })}`;
  const result = await postcss([tailwindV3!({ content: [{ raw: '<div class="flex text-red-500"></div>', extension: 'html' }], corePlugins: { preflight: false } })]).process(css, { from: undefined });
  expect(result.css).toContain('.flex');
  expect(result.css).toContain('display: flex');
  expect(result.css).toContain('@layer source-components');
  expect(result.css).toContain('.card');
  expect(result.css).toContain('.native');
  expect(layers(result.css)[0]).toBe('theme, source-base, source-components, source-utilities');
  const root = postcss.parse(result.css);
  root.walkAtRules((rule) => { expect(['tailwind', 'apply', 'theme', 'utility']).not.toContain(rule.name); });
});
