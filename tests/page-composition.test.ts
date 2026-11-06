import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import path from 'node:path';
import { domAnalyzer } from '../src/generator/analyzer/dom-analyzer.js';
import { componentDetector } from '../src/generator/analyzer/component-detector.js';
import { canonicalDomHash } from '../src/generator/codegen/jsx-transformer.js';
import { generatePageRoute } from '../src/generator/codegen/page-generator.js';
import { generateSectionComponent } from '../src/generator/codegen/component-generator.js';
import { generateRootLayout } from '../src/generator/codegen/layout-generator.js';
import type { PageInventoryItem } from '../src/generator/types.js';

function item(route = '/'): PageInventoryItem {
  return {
    url: `https://example.com${route}`, route, title: 'Fixture', description: null,
    canonicalUrl: null, componentName: 'FixturePage', headingsCount: 0,
    imagesCount: 0, linksCount: 0, hasHeader: true, hasFooter: true, hasNav: true,
  };
}
function expectParseable(filePath: string, code: string) {
  const source = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  expect((source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
}
const body = '<div class="site-shell"><header><nav><a href="/">Home</a></nav></header><div class="hero-wrapper"><h1>Before</h1><section id="hero"><article id="card"><p>Card</p></article><p>Tail</p></section><p>After</p></div><aside>Residual</aside><footer>Footer</footer></div>';

// Reconstruct generated DOM to verify extraction did not move, drop or duplicate subtrees.
function recompose(page: ReturnType<typeof generatePageRoute>): string {
  let html = page.code.slice(page.code.indexOf('      ', page.code.indexOf('return ('))).trim();
  html = html.slice(0, html.lastIndexOf('</div>')).trim();
  for (let pass = 0; pass < 10; pass++) {
    for (const component of page.generatedComponents || []) {
      const start = component.code.indexOf('return (') + 'return ('.length;
      const fragment = component.code.slice(start, component.code.indexOf('\n  );', start)).trim();
      html = html.replaceAll(`<${component.componentName}></${component.componentName}>`, fragment).replaceAll(`<${component.componentName} />`, fragment);
    }
  }
  return html.replaceAll('className=', 'class=');
}

describe('Source-preserving page composition', () => {
  it('captures intact body without legacy chrome markers, while retaining legacy extraction', () => {
    const structure = domAnalyzer.analyzePage(`<html><head><title>Fixture</title></head><body id="home" class="theme">${body}<script>tracking()</script></body></html>`, 'https://example.com');
    expect(structure.bodyContentHtml).toBe(`${body}<script>tracking()</script>`);
    expect(structure.bodyContentHtml).not.toContain('data-next-layout-node');
    expect(structure.mainContentHtml).not.toContain('<header>');
    expect(structure.mainContentHtml).not.toContain('<footer>');
    expect(structure.sections).toHaveLength(2);
    expect(structure.sections.every((section) => !section.html.includes('data-next-layout-node'))).toBe(true);
  });

  it.each(['standard', 'deep'] as const)('replaces exact subtrees in place in %s mode, preserving all wrappers and chrome', (componentExtraction) => {
    const structure = domAnalyzer.analyzePage(`<body>${body}</body>`, 'https://example.com');
    const page = generatePageRoute({ item: item(), rawContentHtml: '<p>Wrong legacy body</p>', bodyContentHtml: structure.bodyContentHtml, sections: structure.sections, isRoot: true, componentExtraction });
    expect(page.generatedComponents).toHaveLength(componentExtraction === 'deep' ? 2 : 1);
    if (componentExtraction === 'deep') {
      const [inner, outer] = page.generatedComponents!;
      expect(outer.code).toContain(`import { ${inner.componentName} } from './${inner.componentName}';`);
      expect(page.code).not.toContain(`import { ${inner.componentName} }`);
      expect(page.code).toContain(`import { ${outer.componentName} }`);
    }
    expect(page.code).not.toContain('Wrong legacy body');
    expect(page.code).not.toMatch(/<(html|head|body)[\s>]/);
    // Next Link is equivalent source navigation for the preservation comparison.
    expect(canonicalDomHash(recompose(page).replaceAll('Link', 'a'))).toBe(canonicalDomHash(body));
    expectParseable(page.filePath, page.code);
    for (const child of page.generatedComponents || []) expectParseable(child.filePath, child.code);
  });

  it('defaults to standard and does not invent components for mismatches or partial fragments', () => {
    const section = '<section id="hero">Actual</section>';
    const page = generatePageRoute({ item: item(), rawContentHtml: `<main>${section}<section id="other">Other</section></main>`, sections: [{ name: 'Wrong', html: '<section id="hero">Changed</section>' }, { name: 'Partial', html: 'Actual' }, { name: 'Hero', html: section }], isRoot: true });
    expect(page.generatedComponents).toHaveLength(1);
    expect(page.code).toContain('<section id="other">Other</section>');
    expect(page.code).toContain('<main>');
    const minimal = generatePageRoute({ item: item(), rawContentHtml: section, sections: [{ name: 'Hero', html: section }], componentExtraction: 'minimal', isRoot: true });
    expect(minimal.generatedComponents).toEqual([]);
    expect(minimal.code).toContain(section);
  });

  it('does not duplicate a source body-context id already inside an extracted component', () => {
    const html = '<section id="home">Content</section>';
    const page = generatePageRoute({ item: item(), rawContentHtml: html, sections: [{ name: 'Home', html }], bodyContext: { id: 'home', className: 'theme' }, isRoot: true });
    expect(page.code).toContain('<div className="page-container theme">');
    expect(page.code).not.toContain('<div id="home"');
    expect(page.generatedComponents![0].code).toContain('id="home"');
  });

  it('deduplicates identical section instances but retains their original positions', () => {
    const html = '<section class="card">Repeat</section>';
    const page = generatePageRoute({ item: item(), rawContentHtml: `<main>${html}<p>Between</p>${html}</main>`, sections: [{ name: 'Card', html }, { name: 'Duplicate', html }], isRoot: true });
    expect(page.generatedComponents).toHaveLength(1);
    expect(canonicalDomHash(recompose(page))).toBe(canonicalDomHash(`<main>${html}<p>Between</p>${html}</main>`));
  });

  it('keeps names, feature paths, imports and child SVG/Lottie assets deterministic', () => {
    const html = '<section id="motion"><svg viewBox="0 0 20 20"><path d="M1 1h2"/></svg><div data-animation-type="lottie" data-src="/assets/motion.json"></div><img src="/assets/photo.jpg"><a href="/help">Help</a></section>';
    const generate = (route: string) => generatePageRoute({ item: item(route), rawContentHtml: html, sections: [{ name: '123 invalid-name', html }], isRoot: false });
    const page = generate('/products/a');
    expect(page).toEqual(generate('/products/a'));
    const child = page.generatedComponents![0];
    expect(child.filePath).toMatch(/^features\/products-a-[a-f0-9]{16}\/components\/[A-Z][A-Za-z0-9]*\.tsx$/);
    expect(child.componentName).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    expect(page.code).toContain(`import { ${child.componentName} } from '../../../${child.filePath.replace(/\.tsx$/, '')}';`);
    expect(page.usesLottie).toBe(true);
    expect(page.code).not.toContain('import { LottieAsset }');
    expect(child.usesLottie).toBe(true);
    expect(child.code).toContain('src="/assets/motion.json"');
    expect(child.code).toContain('src="/assets/photo.jpg"');
    expect(child.code).toContain("import Link from 'next/link'");
    expect(page.svgAssets).toEqual(child.svgAssets);
    const svg = child.svgAssets[0];
    expect(child.code).toContain(`from '../../../${svg.filePath.replace(/\.tsx$/, '')}'`);
    expect(path.posix.normalize(path.posix.join(path.posix.dirname(child.filePath), `../../../${svg.filePath}`))).toBe(svg.filePath);
    expect(generate('/products-a').generatedComponents![0].filePath).not.toBe(child.filePath);
    expectParseable(page.filePath, page.code);
    expectParseable(child.filePath, child.code);
  });

  it('avoids synthetic document elements for legacy document inputs', () => {
    const page = generatePageRoute({ item: item(), rawContentHtml: `<html><head><title>Hidden</title></head><body>${body}</body></html>`, isRoot: true });
    expect(page.code).not.toMatch(/<(html|head|body)[\s>]/);
    expect(page.code).toContain('site-shell');
    expect(page.code).toContain('<footer>Footer</footer>');
    expectParseable(page.filePath, page.code);
  });

  it('renders children directly without global chrome/flex only when preservation is opted in', () => {
    const options = { siteTitle: 'Fixture', hasHeader: true, hasFooter: true, hasNavigation: true, bodyClassName: 'source-theme' };
    const preserved = generateRootLayout({ ...options, preserveSourceLayout: true });
    expect(preserved).toContain('<body className="source-theme">\n        {children}');
    expect(preserved).not.toContain('components/layout');
    expect(preserved).not.toContain('flex');
    expect(preserved).not.toContain('<main');
    const legacy = generateRootLayout(options);
    expect(legacy).toContain('<Header />');
    expect(legacy).toContain('<Footer />');
    expect(legacy).toContain('<main className="flex-1">{children}</main>');
    expectParseable('layout.tsx', preserved);
  });

  it('preserves the legacy three-argument section API and SVG relative imports', () => {
    const child = generateSectionComponent('LegacySection', '<section><svg><path d="M0 0"/></svg></section>', true);
    expect(child.filePath).toBe('components/sections/LegacySection.tsx');
    expect(child.code).toContain("'use client';");
    expect(child.code).toContain(`from '../../assets/svg/${child.svgAssets[0].componentName}'`);
    expectParseable(child.filePath, child.code);
  });
});

describe('Exact shared DOM detection', () => {
  it.each([
    '<section id="same"><a href="/different">Same</a></section>',
    '<section id="same"><a href="/same">Different</a></section>',
    '<section id="different"><a href="/same">Same</a></section>',
    '<section id="same"><a href="/same" data-state="changed">Same</a></section>',
    '<section id="same"><a href="/same"> Same </a></section>',
  ])('does not falsely share matching tag/class skeleton: %s', (different) => {
    const base = '<section id="same"><a href="/same">Same</a></section>';
    const pages = [base, different].map((html, index) => ({ route: index ? '/other' : '/', structure: domAnalyzer.analyzePage(`<body><header>${html}</header>${html}</body>`, 'https://example.com') }));
    expect(componentDetector.detectSharedComponents(pages)).toEqual([]);
  });

  it('canonicalizes attribute ordering but retains tree boundaries and exact content', () => {
    expect(canonicalDomHash('<section id="a" class="x">Text</section>')).toBe(canonicalDomHash('<section class="x" id="a">Text</section>'));
    expect(canonicalDomHash('<div><p>A</p><p>B</p></div>')).not.toBe(canonicalDomHash('<div><p>A<p>B</p></p></div>'));
    const pages = ['<section id="a" class="x">Text</section>', '<section class="x" id="a">Text</section>'].map((html, index) => ({ route: index ? '/other' : '/', structure: domAnalyzer.analyzePage(`<body>${html}</body>`, 'https://example.com') }));
    expect(componentDetector.detectSharedComponents(pages)).toHaveLength(1);
  });
});
