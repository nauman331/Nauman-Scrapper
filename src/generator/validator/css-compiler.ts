import fs from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import nesting from 'postcss-nesting';

/** Executes the CSS plugins shipped in the generated project, not just a parser. */
export async function compileGeneratedCss(projectRoot: string, strategy: 'original' | 'tailwind'): Promise<void> {
  const sourceRoot = await fs.stat(path.join(projectRoot, 'src/app')).then(() => 'src', () => '');
  const cssPath = path.join(projectRoot, sourceRoot, 'app', 'globals.css');
  const css = await fs.readFile(cssPath, 'utf8');
  const plugins = [nesting()];
  if (strategy === 'tailwind') {
    // Explicit absolute globs prevent the backend cwd from selecting unrelated files.
    plugins.push(tailwindcss({
      content: ['app', 'components', 'features', 'assets'].map((directory) =>
        path.join(projectRoot, sourceRoot, directory, '**/*.{ts,tsx,js,jsx,mdx}').replaceAll('\\', '/')),
      theme: { extend: {} },
      plugins: [],
    }));
  }
  plugins.push(autoprefixer());
  const result = await postcss(plugins).process(css, { from: cssPath, map: false });
  const compiled = postcss.parse(result.css, { from: cssPath });
  compiled.walkDecls((declaration) => {
    if (/url\s*\([^)]*(?:&quot;|&#34;|&#x22;|&apos;|&#39;|&#x27;)/i.test(declaration.value)) {
      throw new Error(`HTML-encoded asset URL in compiled CSS (${declaration.prop}). Regenerate this project with URL declarations preserved as CSS.`);
    }
  });
}
