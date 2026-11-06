import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import ts from 'typescript';
import postcss from 'postcss';
import type { ValidationReport } from '../types.js';
import { UNCOMPILED_SOURCE_DIRECTIVES } from '../css-sanitizer.js';

const REQUIRED_FILES = [
  'package.json',
  'tsconfig.json',
  'README.md',
];

export class StaticValidator {
  /**
   * Performs comprehensive static validation on the generated Next.js project
   */
  async validateProject(
    projectRoot: string,
    knownRoutes: string[],
    downloadedAssets: string[],
    unresolvedAssets: string[],
    cssStrategy: 'original' | 'tailwind' = 'original'
  ): Promise<ValidationReport> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const brokenInternalRoutes: string[] = [];
    let assetReferencesValid = true;
    let checkedFilesCount = 0;

    const appRoot = existsSync(path.join(projectRoot, 'src/app')) ? 'src/app' : 'app';
    let aliasRoot = appRoot === 'src/app' ? 'src' : '.';
    try {
      const configText = await fs.readFile(path.join(projectRoot, 'tsconfig.json'), 'utf8');
      const config = ts.parseConfigFileTextToJson('tsconfig.json', configText).config;
      const alias = config?.compilerOptions?.paths?.['@/*']?.[0];
      if (typeof alias === 'string' && alias.endsWith('/*')) aliasRoot = alias.slice(0, -2);
    } catch { /* Required file checks report missing config below. */ }

    // 1. Verify required files exist
    let requiredFilesExist = true;
    // A selected subpage (e.g. /talk) does not require an unrelated '/' page.
    // Require every advertised route instead of assuming the site root was selected.
    const routeFiles = knownRoutes.map((route) => `${appRoot}${route === '/' ? '' : route.replace(/\/$/, '')}/page.tsx`);
    if (!routeFiles.length) {
      requiredFilesExist = false;
      errors.push('No generated page routes were provided.');
    }
    for (const reqFile of [...REQUIRED_FILES, ...['layout.tsx', 'globals.css'].map((file) => `${appRoot}/${file}`), ...routeFiles]) {
      const absPath = path.join(projectRoot, reqFile);
      if (!existsSync(absPath)) {
        requiredFilesExist = false;
        errors.push(`Missing required project file: ${reqFile}`);
      }
    }

    if (cssStrategy === 'tailwind') {
      for (const configFile of ['tailwind.config.mjs', 'postcss.config.mjs']) {
        if (!existsSync(path.join(projectRoot, configFile))) {
          requiredFilesExist = false;
          errors.push(`Missing Tailwind project file: ${configFile}`);
        }
      }

      try {
        const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')) as {
          devDependencies?: Record<string, string>;
        };
        if (!packageJson.devDependencies?.tailwindcss || !packageJson.devDependencies?.postcss) {
          errors.push('Tailwind strategy requires tailwindcss and postcss dependencies.');
        }
      } catch (error) {
        errors.push(
          `Could not validate Tailwind configuration: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 2. Scan and validate all .ts / .tsx files for syntax and imports
    const tsFiles = await this.findTsFiles(projectRoot);
    checkedFilesCount = tsFiles.length;

    let syntaxValid = true;
    let importReferencesValid = true;

    const normalizedKnownRoutes = new Set(knownRoutes.map((r) => r.toLowerCase()));

    for (const relFile of tsFiles) {
      const absFile = path.join(projectRoot, relFile);
      const content = await fs.readFile(absFile, 'utf8');

      // Syntax checks: balanced brackets and JSX tags
      const syntaxCheck = this.checkBasicSyntax(content, relFile);
      if (!syntaxCheck.valid) {
        syntaxValid = false;
        errors.push(...syntaxCheck.errors);
      }

      // AST traversal catches side-effect imports, re-exports and literal dynamic
      // imports without interpreting comments or copied text as module references.
      const sourceFile = ts.createSourceFile(relFile, content, ts.ScriptTarget.Latest, true);
      const moduleReferences = new Set<string>();
      const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          moduleReferences.add(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          moduleReferences.add(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      for (const reference of moduleReferences) {
        if (!reference.startsWith('@/') && !reference.startsWith('./') && !reference.startsWith('../')) continue;
        const target = reference.startsWith('@/')
          ? path.resolve(projectRoot, aliasRoot, reference.slice(2))
          : path.resolve(path.dirname(absFile), reference);
        if (!this.resolveLocalImport(target, projectRoot)) {
          importReferencesValid = false;
          errors.push(`Broken import in ${relFile}: Cannot resolve '${reference}'`);
        }
      }

      // Check internal <Link href="..."> references
      const linkMatches = content.matchAll(/href=["'](\/[^"'#?]*)["']/g);
      for (const match of linkMatches) {
        const hrefRoute = match[1].toLowerCase();
        // Allow public static assets and root
        if (
          hrefRoute !== '/' &&
          !hrefRoute.startsWith('/cloned-assets/') &&
          !hrefRoute.startsWith('/images') &&
          !hrefRoute.startsWith('/fonts') &&
          !hrefRoute.startsWith('/icons') &&
          !hrefRoute.startsWith('/css')
          && !hrefRoute.startsWith('/animations')
        ) {
          if (!normalizedKnownRoutes.has(hrefRoute)) {
            warnings.push(
              `Possible broken internal link in ${relFile}: Route '${match[1]}' not in generated project.`
            );
            if (!brokenInternalRoutes.includes(match[1])) {
              brokenInternalRoutes.push(match[1]);
            }
          }
        }
      }
    }

    for (const relFile of tsFiles) {
      const content = await fs.readFile(path.join(projectRoot, relFile), 'utf8');
      for (const match of content.matchAll(/src=["'](\/(?:cloned-assets\/)?animations\/[^"']+)["']/g)) {
        const relativeAsset = match[1].replace(/^\//, '');
        if (!existsSync(path.join(projectRoot, 'public', relativeAsset.replace(/^animations\//, 'animations/')))) {
          assetReferencesValid = false;
          errors.push(`Missing Lottie animation referenced in ${relFile}: ${match[1]}`);
        }
      }
      if (/data-src=["']https?:\/\/[^"']+["'][^>]*data-animation-type=["']lottie|data-animation-type=["']lottie["'][^>]*data-src=["']https?:\/\//i.test(content)) {
        assetReferencesValid = false;
        errors.push(`Unlocalized remote Lottie data-src in ${relFile}.`);
      }
    }

    // 3. Asset validation
    if (unresolvedAssets.length > 0) {
      warnings.push(
        `${unresolvedAssets.length} external source asset(s) could not be retrieved and were skipped.`
      );
    }

    // 4. Validate globals.css for broken relative CSS module references
    const globalsCssPath = path.join(projectRoot, appRoot, 'globals.css');
    if (existsSync(globalsCssPath)) {
      const cssContent = await fs.readFile(globalsCssPath, 'utf8');
      try {
        const root = postcss.parse(cssContent, { from: `${appRoot}/globals.css` });
        const generatedDirectives = new Set<string>();
        root.walkAtRules((atRule) => {
          const name = atRule.name.toLowerCase();
          if (name === 'import') {
            const reference = atRule.params.match(/^(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s)]+))/iu);
            const url = reference?.[1] ?? reference?.[2] ?? reference?.[3];
            if (url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(url)) {
              const target = url.startsWith('/')
                ? path.resolve(projectRoot, 'public', `.${url.split(/[?#]/u)[0]}`)
                : path.resolve(path.dirname(globalsCssPath), url.split(/[?#]/u)[0]);
              if (!this.isWithin(target, path.resolve(projectRoot)) || !this.isFile(target)) {
                importReferencesValid = false;
                errors.push(`Broken CSS import in ${appRoot}/globals.css: Cannot resolve '${url}'. Inline or download the imported stylesheet before packaging.`);
              }
            }
          }
          if (!UNCOMPILED_SOURCE_DIRECTIVES.has(name)) return;
          const generated = cssStrategy === 'tailwind' && name === 'tailwind' && atRule.parent === root && atRule.nodes === undefined && ['base', 'components', 'utilities'].includes(atRule.params.trim());
          if (generated) {
            generatedDirectives.add(atRule.params.trim());
            return;
          }
          syntaxValid = false;
          errors.push(`Incompatible source CSS directive @${name} in ${appRoot}/globals.css:${atRule.source?.start?.line ?? 1}:${atRule.source?.start?.column ?? 1}. Compile the source stylesheet with its original CSS/Tailwind toolchain before importing it.`);
        });
        if (cssStrategy === 'tailwind' && !generatedDirectives.has('utilities')) {
          errors.push(`Tailwind strategy requires generated top-level @tailwind utilities in ${appRoot}/globals.css.`);
        }
        if (downloadedAssets.length > 0) {
          const localUrls = new Set<string>();
          root.walkDecls((declaration) => {
            for (const match of declaration.value.matchAll(/url\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^)]*))\s*\)/giu)) {
              const url = (match[1] ?? match[2] ?? match[3]).trim();
              if (url.startsWith('/') && !url.startsWith('//')) localUrls.add(url);
            }
          });
          for (const url of localUrls) {
            let pathname: string;
            try { pathname = decodeURIComponent(url.split(/[?#]/u)[0]); } catch { pathname = url; }
            const target = path.resolve(projectRoot, 'public', `.${pathname}`);
            if (!this.isWithin(target, path.resolve(projectRoot, 'public')) || !this.isFile(target)) {
              assetReferencesValid = false;
              errors.push(`Missing local CSS asset in ${appRoot}/globals.css: ${url}. Ensure the asset is downloaded into public before packaging.`);
            }
          }
        }
      } catch (error) {
        syntaxValid = false;
        const cssError = error as { reason?: string; line?: number; column?: number; message?: string };
        const location = cssError.line && cssError.column ? `:${cssError.line}:${cssError.column}` : '';
        errors.push(
          `CSS syntax error in ${appRoot}/globals.css${location}: ${cssError.reason ?? cssError.message ?? String(error)}`
        );
      }
      // Consume the entire quoted URL before classification. A data SVG can
      // itself contain text such as url(%23noise), which is not a CSS asset.
      const cssUrls = Array.from(cssContent.matchAll(/url\(\s*((?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?:\\[\s\S]|[^)'"\\])*))\s*\)/gi))
        .map((match) => match[1].trim().replace(/^(["'])([\s\S]*)\1$/, '$2'));
      const relativeUrls = cssUrls.filter((url) => url && !/^(?:\/|https?:\/\/|data:|blob:|#)/i.test(url));

      if (relativeUrls.length > 0) {
        assetReferencesValid = false;
        errors.push(
          `Unresolved relative asset URL(s) in ${appRoot}/globals.css: ${relativeUrls.slice(0, 3).join(', ')}${
            relativeUrls.length > 3 ? ` (+${relativeUrls.length - 3} more)` : ''
          }. In Next.js, relative CSS URLs must be resolved to public root paths (/...) or absolute URLs to prevent Webpack module not found crashes.`
        );
      }

      const encodedQuoteAssetUrls = cssUrls.filter((url) =>
        !/^(?:data:|blob:|#)/i.test(url) && /%22|%27|&quot;|&#(?:34|39);/i.test(url));
      if (encodedQuoteAssetUrls.length > 0) {
        assetReferencesValid = false;
        errors.push(
          `Invalid encoded-quote asset URL(s) in ${appRoot}/globals.css: ${encodedQuoteAssetUrls.slice(0, 3).join(', ')}${
            encodedQuoteAssetUrls.length > 3 ? ` (+${encodedQuoteAssetUrls.length - 3} more)` : ''
          }.`
        );
      }

      const localFontNames = new Set(
        downloadedAssets
          .filter((asset) => /^\/(?:cloned-assets\/)?fonts\//i.test(asset))
          .map((asset) => asset.split('/').pop()?.toLowerCase())
          .filter((name): name is string => Boolean(name))
      );
      const remoteFontsWithLocalCopies = Array.from(
        cssContent.matchAll(
          /url\(\s*["']?(https?:\/\/[^"')]+\.(?:woff2?|ttf|otf|eot)(?:[?#][^"')]*)?)["']?\s*\)/gi
        )
      )
        .filter((match) => {
          try {
            const filename = new URL(match[1]).pathname.split('/').filter(Boolean).pop()?.toLowerCase();
            return Boolean(filename && localFontNames.has(filename));
          } catch {
            return false;
          }
        })
        .map((match) => match[1]);
      if (remoteFontsWithLocalCopies.length > 0) {
        assetReferencesValid = false;
        errors.push(
          `Remote font URL(s) in ${appRoot}/globals.css should use downloaded local assets: ${remoteFontsWithLocalCopies.slice(0, 3).join(', ')}.`
        );
      }
    }

    const uniqueErrors = [...new Set(errors)];
    const passed = uniqueErrors.length === 0 && requiredFilesExist && syntaxValid && importReferencesValid;

    return {
      passed,
      requiredFilesExist,
      syntaxValid,
      importReferencesValid,
      assetReferencesValid,
      errors: uniqueErrors,
      warnings,
      checkedFilesCount,
      missingAssets: unresolvedAssets,
      brokenInternalRoutes,
    };
  }

  private isWithin(target: string, root: string): boolean {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  private isFile(target: string): boolean {
    try { return ts.sys.fileExists(target); } catch { return false; }
  }

  private resolveLocalImport(target: string, projectRoot: string): boolean {
    if (!this.isWithin(target, path.resolve(projectRoot))) return false;
    const candidates = [target];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json'];
    if (!path.extname(target)) {
      candidates.push(...extensions.map((extension) => `${target}${extension}`));
      candidates.push(...extensions.map((extension) => path.join(target, `index${extension}`)));
    } else if (/\.(?:[cm]?js|jsx)$/u.test(target)) {
      // NodeNext source imports deliberately use emitted JavaScript extensions.
      const stem = target.replace(/\.(?:[cm]?js|jsx)$/u, '');
      const replacements = target.endsWith('.mjs') ? ['.mts'] : target.endsWith('.cjs') ? ['.cts'] : ['.ts', '.tsx'];
      candidates.push(...replacements.map((extension) => `${stem}${extension}`));
    }
    return candidates.some((candidate) => this.isFile(candidate));
  }

  private async findTsFiles(dir: string, baseDir = dir): Promise<string[]> {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.next') {
          const sub = await this.findTsFiles(fullPath, baseDir);
          results.push(...sub);
        }
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
      }
    }

    return results;
  }

  private checkBasicSyntax(content: string, filename: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const isTsx = filename.endsWith('.tsx');
      const sourceFile = ts.createSourceFile(
        filename,
        content,
        ts.ScriptTarget.Latest,
        true,
        isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      const diagnostics =
        (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics || [];
      for (const diag of diagnostics) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(diag.start ?? 0);
        const msg = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText;
        errors.push(`Syntax error in ${filename} (line ${line + 1}): ${msg}`);
      }
    } catch (err) {
      errors.push(`Parse error in ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export const staticValidator = new StaticValidator();
