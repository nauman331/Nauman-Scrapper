import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileGeneratedCss } from '../src/generator/validator/css-compiler.js';
import { generatePostCssConfig, generateTailwindConfig } from '../src/generator/codegen/project-template.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function project(css: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scraper-css-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'app'));
  await fs.writeFile(path.join(root, 'app/globals.css'), css);
  await fs.writeFile(path.join(root, 'app/page.tsx'), 'export default function Page(){ return <div className="text-red-500"/>; }');
  return root;
}

describe('Generated CSS plugin compilation', () => {
  it('compiles native nested source CSS in original mode', async () => {
    const root = await project('@layer theme, utilities; @layer utilities { .card { color:red; & > span { color:blue; } } }');
    await expect(compileGeneratedCss(root, 'original')).resolves.toBeUndefined();
    expect(generatePostCssConfig('original')).not.toContain('tailwindcss:');
    expect(generatePostCssConfig('original')).toContain('postcss-nesting');
  });
  it('runs Tailwind against extracted feature files and namespaced source layers', async () => {
    const root = await project('@tailwind base; @tailwind components; @tailwind utilities; @layer source-utilities { .source-card { & > span { color:red; } } }');
    await expect(compileGeneratedCss(root, 'tailwind')).resolves.toBeUndefined();
    expect(generateTailwindConfig()).toContain('./features/**/*');
  });
  it('reports errors that plain structural PostCSS parsing would accept', async () => {
    const root = await project('@tailwind utilities; .x { @apply utility-that-does-not-exist; }');
    await expect(compileGeneratedCss(root, 'tailwind')).rejects.toThrow();
  });
});
