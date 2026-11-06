import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import ts from 'typescript';
import postcss from 'postcss';
import {
  urlToNextRoute,
  routeToComponentName,
  buildPageInventory,
} from '../src/generator/inventory/page-inventory.js';
import { domAnalyzer } from '../src/generator/analyzer/dom-analyzer.js';
import { componentDetector } from '../src/generator/analyzer/component-detector.js';
import { interactionClassifier } from '../src/generator/analyzer/interaction-classifier.js';
import { assetCollector } from '../src/generator/assets/asset-collector.js';
import { assetDownloader } from '../src/generator/assets/asset-downloader.js';
import { htmlToJsx, parseStyleStringToJsxObject } from '../src/generator/codegen/jsx-transformer.js';
import { generateSharedComponent } from '../src/generator/codegen/component-generator.js';
import { generatePageRoute } from '../src/generator/codegen/page-generator.js';
import { staticValidator } from '../src/generator/validator/static-validator.js';
import { conversionStorage } from '../src/generator/storage.js';
import { zipPackager } from '../src/generator/packager/zip-packager.js';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';
import {
  generatePackageJson,
  generateLottieAssetComponent,
  generatePostCssConfig,
  generateTailwindConfig,
} from '../src/generator/codegen/project-template.js';
import { rewriteBodyContextSelectors, sanitizeGeneratedCss } from '../src/generator/css-sanitizer.js';
import { deriveSiteBodyContext, removeCommonBodyClasses } from '../src/generator/analyzer/body-context.js';
import { generateRootLayout } from '../src/generator/codegen/layout-generator.js';

describe('Website to Next.js Generator Engine', () => {
  describe('URL to Route Normalization', () => {
    const root = 'https://example.com';

    it('normalizes root URL to /', () => {
      expect(urlToNextRoute('https://example.com', root)).toBe('/');
      expect(urlToNextRoute('https://example.com/', root)).toBe('/');
      expect(urlToNextRoute('https://example.com/index.html', root)).toBe('/');
    });

    it('normalizes subpages and strips file extensions', () => {
      expect(urlToNextRoute('https://example.com/about.html', root)).toBe('/about');
      expect(urlToNextRoute('https://example.com/contact-us/', root)).toBe('/contact-us');
      expect(urlToNextRoute('https://example.com/blog/posts/first-post.php', root)).toBe(
        '/blog/posts/first-post'
      );
    });

    it('generates valid PascalCase component names', () => {
      expect(routeToComponentName('/')).toBe('HomePage');
      expect(routeToComponentName('/about')).toBe('AboutPage');
      expect(routeToComponentName('/contact-us')).toBe('ContactUsPage');
      expect(routeToComponentName('/blog/posts/first-post')).toBe('BlogPostsFirstPostPage');
    });

    it('limits inventory titles to 60 characters and prefers document title over polluted metadata', () => {
      const pages = [
        { url: 'https://example.com/contact', rawData: { html: '<title> Contact   · H&amp;S Real Estate </title>', metadata: { title: 'Contact · H&S Real Estate' + 'Country'.repeat(100) } } },
        { url: 'https://example.com/long', rawData: { metadata: { title: 'A'.repeat(61) } } },
        { url: 'https://example.com/exact', rawData: { metadata: { title: 'B'.repeat(60) } } },
        { url: 'https://example.com/unicode', rawData: { metadata: { title: '😀'.repeat(61) } } },
      ];
      const inventory = buildPageInventory('job', 'https://example.com', 'example.com', pages);
      expect(inventory.pages[0].title).toBe('Contact · H&S Real Estate');
      expect(inventory.pages[1].title).toBe('A'.repeat(57) + '...');
      expect(inventory.pages[2].title).toBe('B'.repeat(60));
      expect(inventory.pages[3].title).toBe('😀'.repeat(57) + '...');
      expect(inventory.pages.every(page => Array.from(page.title).length <= 60)).toBe(true);
    });

    it('builds page inventory with duplicate route resolution', () => {
      const rawPages = [
        {
          url: 'https://example.com/',
          rawData: { html: '<html><head><title>Home</title></head><body><h1>Welcome</h1></body></html>' },
        },
        {
          url: 'https://example.com/about',
          rawData: { html: '<html><head><title>About</title></head><body><p>About us</p></body></html>' },
        },
        {
          url: 'https://example.com/about.html',
          rawData: {
            html: '<html><head><title>About 2</title></head><body><p>Duplicate route</p></body></html>',
          },
        },
      ];

      const inv = buildPageInventory('job-1', 'https://example.com', 'example.com', rawPages);
      expect(inv.pages).toHaveLength(3);
      expect(inv.pages[0].route).toBe('/');
      expect(inv.pages[1].route).toBe('/about');
      expect(inv.pages[2].route).toBe('/about-2'); // Handled collision
    });
  });

  describe('DOM Analyzer & Semantic Extraction', () => {
    it('extracts header, footer, navigation, and content sections', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <meta name="description" content="Test description">
            <link rel="stylesheet" href="/styles.css">
          </head>
          <body>
            <header class="site-header">
              <nav><a href="/">Home</a><a href="/about">About</a></nav>
            </header>
            <main>
              <section id="hero" class="hero-block">
                <h1>Hero Headline</h1>
                <p>Welcome to our website.</p>
              </section>
              <section id="features">
                <h2>Features</h2>
                <p>Fast, reliable, secure.</p>
              </section>
            </main>
            <footer class="site-footer">
              <p>&copy; 2026 Test Site</p>
            </footer>
          </body>
        </html>
      `;

      const structure = domAnalyzer.analyzePage(html, 'https://example.com', 'https://example.com');
      expect(structure.headTitle).toBe('Test Page');
      expect(structure.headerHtml).toContain('site-header');
      expect(structure.footerHtml).toContain('site-footer');
      expect(structure.sections).toHaveLength(2);
      expect(structure.sections[0].name).toBe('HeroSection');
      expect(structure.sections[1].name).toBe('FeaturesSection');
    });

    it('removes exact class fallback chrome while preserving hero wrappers', () => {
      const html = `<body id="home" class="theme-home"><div class="banner"><div class="header"><a href="/">Logo</a><a href="/buy">Buy</a></div><h1>Hero</h1></div><div class="header sticky"><a href="/">Logo</a><a href="/buy">Buy</a></div><main>Content</main><div class="footer">Footer</div></body>`;
      const structure = domAnalyzer.analyzePage(html, 'https://example.com');
      expect(structure.bodyContext).toEqual({ id: 'home', className: 'theme-home' });
      expect(structure.headerHtml).toContain('class="header"');
      expect(structure.footerHtml).toContain('class="footer"');
      expect(structure.mainContentHtml).toContain('<h1>Hero</h1>');
      expect(structure.mainContentHtml).not.toContain('sticky');
      expect(structure.mainContentHtml).not.toContain('class="footer"');
    });

    it('rewrites internal links to Next.js routes', () => {
      const html = `<div><a href="https://example.com/about.html">About</a><a href="https://external.com">External</a></div>`;
      const rewritten = domAnalyzer.rewriteInternalLinks(html, 'https://example.com', [
        'https://example.com/about.html',
      ]);
      expect(rewritten).toContain('href="/about"');
      expect(rewritten).toContain('href="https://external.com"');
    });
  });

  describe('Body Context CSS and Page Generation', () => {
    it('retargets body-qualified selectors and emits the matching wrapper', () => {
      const css = rewriteBodyContextSelectors(
        'body#home .purple h2 { color: white } body.theme .card { background: red } body { margin: 0 } :is(body#home, .x) { color: blue }'
      );
      expect(css).toContain('#home .purple h2');
      expect(css).toContain('.theme .card');
      expect(css).toContain('body { margin: 0 }');
      expect(css).toContain(':is(body#home, .x)');
      const page = generatePageRoute({
        item: {
          url: 'https://example.com',
          route: '/',
          title: 'Home',
          description: null,
          canonicalUrl: null,
          componentName: 'HomePage',
          headingsCount: 0,
          imagesCount: 0,
          linksCount: 0,
          hasHeader: true,
          hasFooter: true,
          hasNav: true,
        },
        rawContentHtml: '<div class="purple"><h2>Title</h2></div>',
        isRoot: true,
        bodyContext: { id: 'home', className: 'theme' },
      });
      expect(page.code).toContain('<div id="home" className="page-container theme">');
    });
  });

  describe('Site-wide Body Context', () => {
    it('moves only common multi-page classes to the layout body', () => {
      const pages = [
        {
          bodyContext: { className: 'elementor-default elementor-kit-9 page-home' },
          html: '<div class="elementor">Home</div>',
        },
        {
          bodyContext: { className: 'elementor-default elementor-kit-9 page-about' },
          html: '<div class="elementor">About</div>',
        },
      ];
      const site = deriveSiteBodyContext(pages, '');
      expect(site.className).toBe('elementor-default elementor-kit-9');
      expect(removeCommonBodyClasses(pages[0].bodyContext, site.className)).toEqual({
        id: undefined,
        className: 'page-home',
      });
    });

    it('puts all single-page classes on body while preserving a page id', () => {
      const site = deriveSiteBodyContext(
        [
          {
            bodyContext: { id: 'home', className: 'elementor-default elementor-kit-9' },
            html: '<main class="elementor">X</main>',
          },
        ],
        '.elementor-kit-9{--e-global-color-secondary:#222326;font-family:"Barlow", Plus Jakarta Sans}'
      );
      const layout = generateRootLayout({
        siteTitle: 'X',
        hasHeader: true,
        hasFooter: false,
        hasNavigation: false,
        bodyClassName: site.className,
      });
      const route = removeCommonBodyClasses(
        { id: 'home', className: 'elementor-default elementor-kit-9' },
        site.className
      );
      expect(layout).toContain('elementor-default elementor-kit-9');
      expect(route).toEqual({ id: 'home', className: undefined });
      expect(
        ts.createSourceFile('layout.tsx', layout, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
          .parseDiagnostics
      ).toEqual([]);
    });

    it('infers one unambiguous Elementor global kit but rejects ambiguity', () => {
      const page = [
        {
          bodyContext: { className: 'elementor-default' },
          html: '<header class="elementor elementor-13"></header>',
        },
      ];
      expect(deriveSiteBodyContext(page, '.elementor-kit-9{--e-global-color-primary:#123}').className).toBe(
        'elementor-default elementor-kit-9'
      );
      expect(
        deriveSiteBodyContext(
          page,
          '.elementor-kit-9{--e-global-color-primary:#123}.elementor-kit-10{--e-global-color-primary:#456}'
        ).className
      ).toBe('elementor-default');
    });
  });
  describe('Shared Component Detection', () => {
    it('detects shared Header and Footer across multiple pages', () => {
      const header = '<header class="main-header"><div class="logo">Logo</div></header>';
      const footer = '<footer class="main-footer"><p>Copyright 2026</p></footer>';

      const page1 = {
        route: '/',
        structure: {
          headTitle: 'Home',
          metaTags: [],
          headerHtml: header,
          footerHtml: footer,
          navHtml: null,
          mainContentHtml: '<div>Home Content</div>',
          sections: [{ name: 'HeroSection', html: '<section>Hero</section>', tagName: 'section' }],
          externalStylesheets: [],
          inlineStyles: [],
          faviconUrl: null,
        },
      };

      const page2 = {
        route: '/about',
        structure: {
          headTitle: 'About',
          metaTags: [],
          headerHtml: header,
          footerHtml: footer,
          navHtml: null,
          mainContentHtml: '<div>About Content</div>',
          sections: [{ name: 'AboutSection', html: '<section>About</section>', tagName: 'section' }],
          externalStylesheets: [],
          inlineStyles: [],
          faviconUrl: null,
        },
      };

      const shared = componentDetector.detectSharedComponents([page1, page2]);
      const headerComp = shared.find((c) => c.name === 'Header');
      const footerComp = shared.find((c) => c.name === 'Footer');

      expect(headerComp).toBeDefined();
      expect(headerComp?.category).toBe('layout');
      expect(footerComp).toBeDefined();
      expect(footerComp?.category).toBe('layout');
    });
  });

  describe('Interaction Classifier', () => {
    it('identifies mobile nav toggles, accordions, and forms', () => {
      const html = `
        <div>
          <button class="navbar-toggler" data-toggle="collapse" aria-expanded="false">Menu</button>
          <div class="accordion">
            <div class="accordion-item">Accordion content</div>
          </div>
          <form action="/api/contact" method="POST">
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        </div>
      `;

      const interactions = interactionClassifier.classifyInteractions(html);
      expect(interactions.some((i) => i.type === 'mobile-nav')).toBe(true);
      expect(interactions.some((i) => i.type === 'accordion')).toBe(true);
      expect(interactions.some((i) => i.type === 'form')).toBe(true);
    });
  });

  describe('Asset Collector', () => {
    it('collects images, stylesheets, fonts, and inline styles', () => {
      const html = `
        <html>
          <head>
            <link rel="stylesheet" href="/assets/css/main.css">
            <link rel="icon" href="/favicon.ico">
          </head>
          <body>
            <img src="/assets/img/logo.png" alt="Logo" />
            <div style="background-image: url('/assets/img/bg.jpg');">Banner</div>
          </body>
        </html>
      `;

      const assets = assetCollector.collectAssets(html, 'https://example.com/page');
      expect(assets.some((a) => a.originalUrl === 'https://example.com/assets/css/main.css')).toBe(true);
      expect(assets.some((a) => a.originalUrl === 'https://example.com/favicon.ico')).toBe(true);
      expect(assets.some((a) => a.originalUrl === 'https://example.com/assets/img/logo.png')).toBe(true);
      expect(assets.some((a) => a.originalUrl === 'https://example.com/assets/img/bg.jpg')).toBe(true);
    });

    it('collects Webflow Lottie and lazy/media asset variants', () => {
      const html = `<div class="hero" data-animation-type="lottie" data-src="/anim/hero.json" data-loop="0"></div>
        <picture><source data-srcset="/wide.webp 2x"><img data-lazy-src="/hero.png"></picture>
        <video poster="/poster.jpg"><source src="/movie.mp4"></video>
        <svg><image xlink:href="/mark.svg" /></svg><object data="/doc.pdf"></object><embed src="/item.bin">`;
      const assets = assetCollector.collectAssets(html, 'https://example.com');
      expect(assets.find((asset) => asset.originalUrl.endsWith('/anim/hero.json'))?.type).toBe('animation');
      for (const suffix of ['/wide.webp', '/hero.png', '/poster.jpg', '/movie.mp4', '/mark.svg', '/doc.pdf', '/item.bin']) {
        expect(assets.some((asset) => asset.originalUrl.endsWith(suffix))).toBe(true);
      }
    });

    it('downloads valid Lottie JSON locally and rejects invalid JSON', async () => {
      const originalFetch = globalThis.fetch;
      const conversionId = `lottie-assets-${Date.now()}`;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const valid = String(input).endsWith('/valid.json');
        return new Response(valid ? '{"v":"5.5.0","layers":[]}' : '<html>bad</html>', {
          headers: { 'content-type': valid ? 'application/json' : 'text/html' },
        });
      }) as typeof fetch;
      try {
        await conversionStorage.setupConversionWorkspace(conversionId);
        const result = await assetDownloader.resolveAssets(conversionId, [
          { originalUrl: 'https://1.1.1.1/valid.json', sourcePageUrl: 'https://example.com', type: 'animation', htmlTag: 'webflow-lottie', suggestedLocalName: 'valid.json' },
          { originalUrl: 'https://1.1.1.1/invalid.json', sourcePageUrl: 'https://example.com', type: 'animation', htmlTag: 'webflow-lottie', suggestedLocalName: 'invalid.json' },
        ]);
        expect(result.downloadedAssets[0]?.publicUrl).toMatch(/^\/animations\/.*\.json$/);
        expect(result.missingAssets.some((item) => item.includes('not valid JSON'))).toBe(true);
        const rewritten = assetDownloader.rewriteAssetUrlsInHtml(
          '<div data-animation-type="lottie" data-src="https://1.1.1.1/valid.json"></div>',
          result.downloadedAssets,
          'https://example.com'
        );
        expect(rewritten).toContain('data-src="/animations/');
      } finally {
        globalThis.fetch = originalFetch;
        await conversionStorage.deleteConversion(conversionId);
      }
    });
  });

  describe('HTML to JSX Transformer', () => {
    it('converts style strings to JSX style objects', () => {
      const style = 'color: red; font-size: 16px; background-color: #fff;';
      const jsxObj = parseStyleStringToJsxObject(style);
      expect(jsxObj).toContain("color: 'red'");
      expect(jsxObj).toContain("fontSize: '16px'");
      expect(jsxObj).toContain("backgroundColor: '#fff'");
    });

    it('transforms localized Webflow Lottie into the reusable component', () => {
      const result = htmlToJsx('<div class="home-hero-visual-image" data-animation-type="lottie" data-src="/animations/hero.json" data-loop="0" data-autoplay="1" data-direction="-1"></div>');
      expect(result.usesLottie).toBe(true);
      expect(result.jsx).toContain('<LottieAsset src="/animations/hero.json"');
      expect(result.jsx).toContain('className="home-hero-visual-image"');
      expect(result.jsx).toContain('loop={false}');
      expect(generateLottieAssetComponent()).toContain("'use client'");
    });

    it('transforms class to className, for to htmlFor, and self-closes img/input tags', () => {
      const rawHtml =
        '<div class="card" style="margin-top: 10px;"><label for="email">Email</label><input type="text" class="input"><img src="/logo.png" alt="logo"></div>';
      const { jsx } = htmlToJsx(rawHtml);
      expect(jsx).toContain('className="card"');
      expect(jsx).toContain('htmlFor="email"');
      expect(jsx).toContain('<input type="text" className="input" />');
      expect(jsx).toContain('<img src="/logo.png" alt="logo" />');
      expect(jsx).toContain('style={{ marginTop:');
    });

    it('escapes literal braces in copied text so generated TSX remains valid', async () => {
      const rawHtml = '<div><code>const app = createServer({ stack: ["Next.js"] });</code></div>';
      const { jsx } = htmlToJsx(rawHtml);

      expect(jsx).toContain('createServer(&#123; stack: ["Next.js"] &#125;);');

      const tempRoot = path.join(process.cwd(), 'storage', `jsx-braces-${Date.now()}`);
      await fs.mkdir(path.join(tempRoot, 'app'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'package.json'), '{}');
      await fs.writeFile(path.join(tempRoot, 'tsconfig.json'), '{}');
      await fs.writeFile(path.join(tempRoot, 'README.md'), 'test');
      await fs.writeFile(
        path.join(tempRoot, 'app', 'layout.tsx'),
        'export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }'
      );
      await fs.writeFile(path.join(tempRoot, 'app', 'globals.css'), '');
      await fs.writeFile(
        path.join(tempRoot, 'app', 'page.tsx'),
        `export default function Page() { return (${jsx}); }`
      );

      try {
        const report = await staticValidator.validateProject(tempRoot, ['/'], [], []);
        expect(report.syntaxValid).toBe(true);
        expect(report.errors).toEqual([]);
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    });

    it('normalizes common React attributes and static form controls into parseable TSX', () => {
      const raw =
        '<div itemtype="https://schema.org/X" itemscope itemid="x" itemprop="name" data-id="1" aria-label="X"><img fetchpriority="high"><form accept-charset="utf-8" novalidate><input value="query" checked readonly><time datetime="2026-01-01"></time><svg enable-background="new" stroke-width="2"></svg></form></div>';
      const result = htmlToJsx(raw);
      const code = `export default function Test(){return (${result.jsx});}`;
      const parsed = ts.createSourceFile('test.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      expect(result.jsx).toContain('itemType="https://schema.org/X"');
      expect(result.jsx).toContain('itemScope={true}');
      expect(result.jsx).toContain('itemID="x"');
      expect(result.jsx).toContain('itemProp="name"');
      expect(result.jsx).toContain('fetchPriority="high"');
      expect(result.jsx).toContain('acceptCharset="utf-8"');
      expect(result.jsx).toContain('defaultValue="query"');
      expect(result.jsx).toContain('defaultChecked={true}');
      expect(result.jsx).not.toMatch(/\svalue=/);
      expect(result.jsx).toContain('data-id="1"');
      expect(result.jsx).toContain('aria-label="X"');
      expect(result.svgAssets[0].code).toContain('enableBackground="new"');
      expect(result.svgAssets[0].code).toContain('strokeWidth={2}');
      expect(parsed.parseDiagnostics).toEqual([]);
    });

    it('emits allowlisted numeric DOM and SVG attributes as typed JSX literals', () => {
      const result = htmlToJsx(
        '<div tabindex="-1" data-count="12" aria-hidden="false" aria-atomic="true" id="123"><textarea rows="4" cols="20" maxlength="120"></textarea><svg viewBox="0 0 24 24" width="24px"><circle cx="12" cy="12" r="10.5" /></svg></div>'
      );
      const svgCode = result.svgAssets[0].code;

      expect(result.jsx).toContain('tabIndex={-1}');
      expect(result.jsx).toContain('rows={4}');
      expect(result.jsx).toContain('cols={20}');
      expect(result.jsx).toContain('maxLength={120}');
      expect(result.jsx).toContain('aria-hidden="false"');
      expect(result.jsx).toContain('aria-atomic="true"');
      expect(result.jsx).toContain('data-count="12"');
      expect(result.jsx).toContain('id="123"');
      expect(svgCode).toContain('cx={12}');
      expect(svgCode).toContain('cy={12}');
      expect(svgCode).toContain('r={10.5}');
      expect(svgCode).toContain('width="24px"');
      expect(svgCode).toContain('viewBox="0 0 24 24"');

      const parsed = ts.createSourceFile(
        'numeric.tsx',
        `export default function Test(){return (${result.jsx});}`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      expect(parsed.parseDiagnostics).toEqual([]);
    });

    it('extracts and deduplicates identical inline SVG markup into stable React assets', () => {
      const svg =
        '<svg class="icon" viewBox="0 0 24 24" aria-label="Search"><path fill="currentColor" fill-rule="evenodd" d="M1 1h2v2H1z" /></svg>';
      const first = htmlToJsx(`<div>${svg}${svg}<img src="/external.svg" alt="External" /></div>`);
      const second = htmlToJsx(svg);

      expect(first.svgAssets).toHaveLength(1);
      expect(second.svgAssets[0].filePath).toBe(first.svgAssets[0].filePath);
      expect(first.jsx.match(new RegExp(`<${first.svgAssets[0].componentName} />`, 'g'))).toHaveLength(2);
      expect(first.jsx).toContain('<img src="/external.svg" alt="External" />');
      expect(first.svgAssets[0].code).toContain('className="icon"');
      expect(first.svgAssets[0].code).toContain('fill="currentColor"');
      expect(first.svgAssets[0].code).toContain('fillRule="evenodd"');
      expect(first.svgAssets[0].code).toContain('aria-label="Search"');
      expect(first.svgAssets[0].code).toContain('SVGProps<SVGSVGElement>');
    });

    it('makes exact problematic SVG namespace syntax parse as TSX', () => {
      const rawSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="-893 477 142 142" enable-background="new -888 480 142 142" xml:space="preserve"><use xlink:href="#mark" custom:value="kept" /><foo:bar aria-label="Mark" /></svg>';
      const asset = htmlToJsx(rawSvg).svgAssets[0];
      const parsed = ts.createSourceFile(
        asset.filePath,
        asset.code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );

      expect(asset.code).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(asset.code).toContain('xmlnsXlink="http://www.w3.org/1999/xlink"');
      expect(asset.code).toContain('xmlSpace="preserve"');
      expect(asset.code).toContain('xlinkHref="#mark"');
      expect(asset.code).toContain('customvalue="kept"');
      expect(asset.code).toContain('<bar aria-label="Mark"');
      expect(parsed.parseDiagnostics).toEqual([]);
      expect(
        asset.code
          .match(/<\/?[A-Za-z][^<>]*>/g)
          ?.some((tag) => /(?:^<\/?|\s)[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*/.test(tag))
      ).toBe(false);
    });

    it('imports extracted SVG assets from shared components and app pages', () => {
      const rawSvg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>';
      const component = generateSharedComponent(
        {
          name: 'Header',
          category: 'layout',
          filePath: 'components/layout/Header.tsx',
          jsxCode: '',
          isClientComponent: false,
          instancesCount: 2,
          usedInRoutes: ['/', '/about'],
        },
        `<header>${rawSvg}</header>`
      );
      const page = generatePageRoute({
        item: {
          url: 'https://example.com',
          route: '/',
          title: 'Home',
          description: null,
          canonicalUrl: null,
          componentName: 'HomePage',
          headingsCount: 0,
          imagesCount: 0,
          linksCount: 0,
          hasHeader: true,
          hasFooter: false,
          hasNav: false,
        },
        rawContentHtml: `<main>${rawSvg}</main>`,
        isRoot: true,
      });

      expect(component.svgAssets).toHaveLength(1);
      expect(page.svgAssets).toHaveLength(1);
      expect(component.svgAssets[0].hash).toBe(page.svgAssets[0].hash);
      expect(component.code).toContain(`from '../../assets/svg/${component.svgAssets[0].componentName}'`);
      expect(page.code).toContain(`from '../assets/svg/${page.svgAssets[0].componentName}'`);
    });

    it('normalizes malformed forms and every HTML void element into parseable generated pages', () => {
      const malformedHtml = `
        <link
          rel="stylesheet"
          href="/assets/forms.css">
        <div class="shell"><form action="/submit"><input
          name="query"
          value="{draft}">
          <div style='--payload: "{quoted}"; background-image: url("data:image/svg+xml,&lt;svg&gt;{x}&lt;/svg&gt;")'>
            Keep literal { braces } and <a href="/help">safe nested content</a>
        <area shape="rect"><base href="/"><br><table><col></table><embed src="/doc"><hr><img src="/image.png"><meta name="robots" content="noindex"><param name="legacy" value="yes"><source src="/movie.mp4"><track src="/captions.vtt"><wbr>
      `;
      const page = generatePageRoute({
        item: {
          url: 'https://example.com/401',
          route: '/401',
          title: 'Unauthorized',
          description: 'Malformed form fixture',
          canonicalUrl: null,
          componentName: 'UnauthorizedPage',
          headingsCount: 0,
          imagesCount: 1,
          linksCount: 1,
          hasHeader: false,
          hasFooter: false,
          hasNav: false,
        },
        rawContentHtml: malformedHtml,
        isRoot: false,
      });
      const parsed = ts.createSourceFile(
        page.filePath,
        page.code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );

      for (const tag of [
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
      ]) {
        expect(page.code).toMatch(new RegExp(`<${tag}\\b[\\s\\S]*?\\s/>`));
      }
      expect(page.code).toContain('<Link href="/help">safe nested content</Link>');
      expect(page.code).toContain('Keep literal &#123; braces &#125;');
      expect(page.code).toContain("'--payload': '\"{quoted}\"'");
      expect(page.code).toContain('backgroundImage:');
      expect(parsed.parseDiagnostics).toEqual([]);
    });

    it('does not self-close <Link> tags when transforming internal links with children', () => {
      const rawHtml =
        '<a href="/contact" class="nav-brand"><img src="/logo.svg" alt="Logo"><span>Brand</span></a>';
      const { jsx, usesLink } = htmlToJsx(rawHtml);
      expect(usesLink).toBe(true);
      expect(jsx).toContain(
        '<Link href="/contact" className="nav-brand"><img src="/logo.svg" alt="Logo" /><span>Brand</span></Link>'
      );
      expect(jsx).not.toContain('<Link href="/contact" className="nav-brand" />');
    });
  });

  describe('Generated CSS sanitization', () => {
    it('removes selectorless and recursively empty rules while preserving valid CSS', () => {
      const sanitized = sanitizeGeneratedCss(
        '.kept { color: red; } {} @media (min-width: 1px) { .empty {} } h1.entry-title { margin: 0; }'
      );

      expect(sanitized).toContain('.kept');
      expect(sanitized).toContain('h1.entry-title');
      expect(sanitized).not.toContain('{}');
      expect(sanitized).not.toContain('@media');
    });

    it('removes only invalid pseudo-element selector branches for both strategies', () => {
      const css = `.orange-button:after,
.green-button:after,
.blue-button:after .disabled-button:after {
  content: none !important;
}`;

      for (const strategy of ['original', 'tailwind'] as const) {
        const sanitized = sanitizeGeneratedCss(css, { strategy });
        expect(sanitized).toContain('.orange-button:after');
        expect(sanitized).toContain('.green-button:after');
        expect(sanitized).not.toContain('.blue-button:after');
        expect(sanitized).toContain('content: none !important');
      }
    });

    it('keeps nested functional pseudo commas together and valid pseudo-element chains', () => {
      const css = `.card:is(.primary, .secondary):not([data-label="a,b"]) span,
.panel:where(:has(.one, [data-value='x,y']))::before,
a:hover span,
input::placeholder,
.x:before:hover { color: red; }`;
      const sanitized = sanitizeGeneratedCss(css);

      expect(sanitized).toContain('.card:is(.primary, .secondary):not([data-label="a,b"]) span');
      expect(sanitized).toContain(".panel:where(:has(.one, [data-value='x,y']))::before");
      expect(sanitized).toContain('a:hover span');
      expect(sanitized).toContain('input::placeholder');
      expect(sanitized).toContain('.x:before:hover');
      expect(sanitized).toContain('color: red');
    });

    it('removes rules when every branch has a combinator after a pseudo-element', () => {
      const css =
        '.a::before > span, .b:after + i, .c::first-line ~ em, .d:first-letter strong { color: red; } .kept::after { content: ""; }';
      const sanitized = sanitizeGeneratedCss(css);

      expect(sanitized).not.toContain('color: red');
      expect(sanitized).not.toContain('.a::before');
      expect(sanitized).toContain('.kept::after');
      expect(sanitized).toContain('content: ""');
    });

    it('preserves cascade ordering while namespacing source layers for Tailwind', () => {
      const css = '@layer reset, base, components; @layer components; @layer base { body { margin: 0; } }';
      const sanitized = sanitizeGeneratedCss(css, { strategy: 'tailwind' });

      expect(sanitized).toContain('@layer reset, source-base, source-components;');
      expect(sanitized).toContain('@layer source-components;');
      expect(sanitized).toContain('@layer source-base { body { margin: 0; } }');
    });

    it('preserves statement-form cascade layers for Original CSS', () => {
      const css = '@layer reset, base, components; @layer components; @layer base { body { margin: 0; } }';
      const sanitized = sanitizeGeneratedCss(css, { strategy: 'original' });

      expect(sanitized).toContain('@layer reset, base, components;');
      expect(sanitized).toContain('@layer components;');
      expect(sanitized).toContain('@layer base { body { margin: 0; } }');
    });

    it('removes unresolved template declarations from minified CSS and preserves neighbors', () => {
      const repeated = Array.from(
        { length: 4 },
        (_, index) =>
          `.item-${index}{--counter-${index}:${index};color:red;text-align:{{VALUE}};display:block}`
      ).join('');
      const sanitized = sanitizeGeneratedCss(`${repeated}.after{color:blue}`);

      expect(sanitized).not.toContain('{{VALUE}}');
      for (let index = 0; index < 4; index += 1) {
        expect(sanitized).toContain(`--counter-${index}:${index}`);
        expect(sanitized).toContain(`.item-${index}`);
      }
      expect(sanitized).toContain('.after');
      expect(() => postcss.parse(sanitized)).not.toThrow();
    });

    it('removes supported unquoted templates but preserves quoted literals and custom properties', () => {
      const css = '.x{content:"{{VALUE}}";--literal:"${safe}";a:<% bad %>;b:${bad};c:{{{bad}}};color:red}';
      const sanitized = sanitizeGeneratedCss(css);

      expect(sanitized).toContain('content:"{{VALUE}}"');
      expect(sanitized).toContain('--literal:"${safe}"');
      expect(sanitized).toContain('color:red');
      expect(sanitized).not.toContain('<% bad %>');
      expect(sanitized).not.toContain('b:${bad}');
      expect(sanitized).not.toContain('{{{bad}}}');
    });

    it('recovers parseable CSS by dropping a malformed rule region', () => {
      const sanitized = sanitizeGeneratedCss('.before{color:red}.broken{color red}.after{display:block}');
      expect(sanitized).not.toContain('.broken');
      expect(sanitized).toContain('.before');
      expect(sanitized).toContain('.after');
      expect(() => postcss.parse(sanitized)).not.toThrow();
    });
  });

  describe('Tailwind CSS Migration', () => {
    it('converts safe simple-class and inline declarations while preserving semantic classes', () => {
      const result = convertDocumentsToTailwind(
        [
          {
            id: 'home',
            html: '<html><body><div class="card" style="padding: 11px; filter: blur(2px)">Hello</div></body></html>',
          },
        ],
        '.card { display: flex; color: #123456; }'
      );

      expect(result.documents[0].html).toContain('class="flex text-[#123456] !p-[11px]"');
      expect(result.documents[0].html).not.toContain('class="card ');
      expect(result.stats.sourceClassesRemoved).toBe(1);
      expect(result.documents[0].html).toContain('style="filter: blur(2px);"');
      expect(result.residualCss.trim()).toBe('');
      expect(result.stats.declarationsConverted).toBe(2);
      expect(result.stats.inlineDeclarationsConverted).toBe(1);
    });

    it('keeps complex and conflicting rules as residual CSS', () => {
      const css = '.card .title { color: red } .card { color: blue } .card { color: green }';
      const result = convertDocumentsToTailwind(
        [{ id: 'home', html: '<div class="card"><span class="title">Hello</span></div>' }],
        css
      );

      expect(result.residualCss).toContain('.card .title');
      expect(result.documents[0].html).toContain('class="card"');
      expect(result.documents[0].html).toContain('class="title"');
      expect(result.residualCss).toContain('color: blue');
      expect(result.residualCss).toContain('color: green');
      expect(result.stats.declarationsConverted).toBe(0);
    });

    it('generates a complete Tailwind project toolchain only for Tailwind mode', () => {
      const base = {
        projectName: 'site',
        domain: 'example.com',
        targetUrl: 'https://example.com',
        routes: [],
        pageCount: 1,
      };
      const tailwindPackage = JSON.parse(generatePackageJson({ ...base, cssStrategy: 'tailwind' }));
      const originalPackage = JSON.parse(generatePackageJson({ ...base, cssStrategy: 'original' }));

      expect(tailwindPackage.dependencies.next).toBe('^16.4.3');
      expect(tailwindPackage.dependencies.react).toBe('^19.3.1');
      expect(tailwindPackage.dependencies['react-dom']).toBe('^19.3.1');
      expect(tailwindPackage.scripts.lint).toBe('tsc --noEmit');
      expect(tailwindPackage.devDependencies.tailwindcss).toBeDefined();
      expect(tailwindPackage.devDependencies.postcss).toBeDefined();
      expect(originalPackage.devDependencies.tailwindcss).toBeUndefined();
      expect(generateTailwindConfig()).toContain("'./app/**/*.{js,ts,jsx,tsx,mdx}'");
      expect(generatePostCssConfig()).toContain('tailwindcss: {}');
    });
  });

  describe('Storage & Path Traversal Security', () => {
    const testConvId = `test_conv_${Date.now()}`;

    afterEach(async () => {
      await conversionStorage.deleteConversion(testConvId);
    });

    it('prevents path traversal attempts', async () => {
      await conversionStorage.setupConversionWorkspace(testConvId);

      await expect(
        conversionStorage.writeFileSafe(testConvId, '../../../etc/passwd', 'malicious')
      ).rejects.toThrow(/Security Violation: Path traversal/);

      await expect(
        conversionStorage.writeFileSafe(testConvId, '..\\..\\windows\\system32\\evil.exe', 'malicious')
      ).rejects.toThrow(/Security Violation: Path traversal/);
    });

    it('writes and reads safe files inside workspace', async () => {
      await conversionStorage.setupConversionWorkspace(testConvId);
      await conversionStorage.writeFileSafe(testConvId, 'app/page.tsx', 'export default function Page() {}');

      const content = await conversionStorage.readFileSafe(testConvId, 'app/page.tsx');
      expect(content).toBe('export default function Page() {}');
    });
  });

  describe('Static Validator & Packager', () => {
    const testConvId = `validator_conv_${Date.now()}`;

    beforeEach(async () => {
      await conversionStorage.setupConversionWorkspace(testConvId);
    });

    afterEach(async () => {
      await conversionStorage.deleteConversion(testConvId);
    });

    it('validates a complete project correctly and packages to ZIP', async () => {
      await conversionStorage.writeFileSafe(testConvId, 'package.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'tsconfig.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'README.md', '# Readme');
      await conversionStorage.writeFileSafe(testConvId, 'app/globals.css', 'body {}');
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/layout.tsx',
        'export default function Root({ children }: { children: any }) { return <html><body>{children}</body></html>; }'
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/page.tsx',
        'export default function Page() { return <div>Home</div>; }'
      );

      const projDir = conversionStorage.getProjectDir(testConvId);
      const report = await staticValidator.validateProject(projDir, ['/'], [], []);

      expect(report.passed).toBe(true);
      expect(report.requiredFilesExist).toBe(true);
      expect(report.syntaxValid).toBe(true);

      const zipPath = conversionStorage.getZipPath(testConvId, 'my-test-app');
      const zipRes = await zipPackager.packageProject(projDir, zipPath);

      expect(zipRes.sizeBytes).toBeGreaterThan(0);
      expect(zipRes.totalEntries).toBeGreaterThanOrEqual(6);
    });

    it('validates a complete generated page containing malformed form and void markup', async () => {
      const page = generatePageRoute({
        item: {
          url: 'https://example.com/401',
          route: '/',
          title: 'Unauthorized',
          description: null,
          canonicalUrl: null,
          componentName: 'UnauthorizedPage',
          headingsCount: 0,
          imagesCount: 0,
          linksCount: 0,
          hasHeader: false,
          hasFooter: false,
          hasNav: false,
        },
        rawContentHtml:
          '<link rel="stylesheet" href="/form.css"><div><form><input name="email"><div>Account {locked}',
        isRoot: true,
      });
      await conversionStorage.writeFileSafe(testConvId, 'package.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'tsconfig.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'README.md', '# Readme');
      await conversionStorage.writeFileSafe(testConvId, 'app/globals.css', 'body {}');
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/layout.tsx',
        'export default function Root({ children }: { children: any }) { return <html><body>{children}</body></html>; }'
      );
      await conversionStorage.writeFileSafe(testConvId, page.filePath, page.code);

      const report = await staticValidator.validateProject(
        conversionStorage.getProjectDir(testConvId),
        ['/'],
        [],
        []
      );

      expect(report.syntaxValid).toBe(true);
      expect(report.errors).toEqual([]);
      expect(new Set(report.errors).size).toBe(report.errors.length);
    });

    it('reports malformed globals.css with line and column', async () => {
      await conversionStorage.writeFileSafe(testConvId, 'package.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'tsconfig.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'README.md', '# Readme');
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/globals.css',
        'body { color: red;\n.invalid { display: block; }'
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/layout.tsx',
        'export default function Root({ children }: { children: any }) { return <html><body>{children}</body></html>; }'
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/page.tsx',
        'export default function Page() { return <div>Home</div>; }'
      );

      const report = await staticValidator.validateProject(
        conversionStorage.getProjectDir(testConvId),
        ['/'],
        [],
        []
      );
      expect(report.passed).toBe(false);
      expect(
        report.errors.some((error) => /CSS syntax error in app\/globals\.css:\d+:\d+:/u.test(error))
      ).toBe(true);
    });

    it('flags encoded-quote font URLs in globals.css', async () => {
      await conversionStorage.writeFileSafe(testConvId, 'package.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'tsconfig.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'README.md', '# Readme');
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/globals.css',
        '@font-face { src: url(%22/fonts/demo.woff2%22); }'
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/layout.tsx',
        'export default function Root({ children }: { children: any }) { return <html><body>{children}</body></html>; }'
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/page.tsx',
        'export default function Page() { return <div>Home</div>; }'
      );

      const report = await staticValidator.validateProject(
        conversionStorage.getProjectDir(testConvId),
        ['/'],
        ['/fonts/demo.woff2'],
        []
      );
      expect(report.passed).toBe(false);
      expect(report.assetReferencesValid).toBe(false);
      expect(report.errors.some((error) => error.includes('Invalid encoded-quote asset URL'))).toBe(true);
    });

    it('flags unresolved relative URLs in globals.css as errors', async () => {
      await conversionStorage.writeFileSafe(testConvId, 'package.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'tsconfig.json', '{}');
      await conversionStorage.writeFileSafe(testConvId, 'README.md', '# Readme');
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/globals.css',
        "@font-face { src: url('../media/fef07dbb0973bf53-s.3p2_lha1f2xer.woff2'); }"
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/layout.tsx',
        'export default function Root({ children }: { children: any }) { return <html><body>{children}</body></html>; }'
      );
      await conversionStorage.writeFileSafe(
        testConvId,
        'app/page.tsx',
        'export default function Page() { return <div>Home</div>; }'
      );

      const projDir = conversionStorage.getProjectDir(testConvId);
      const report = await staticValidator.validateProject(projDir, ['/'], [], []);

      expect(report.passed).toBe(false);
      expect(
        report.errors.some((e) => e.includes('Unresolved relative asset URL(s) in app/globals.css'))
      ).toBe(true);
    });
  });

  describe('CSS Asset & Font Resolution', () => {
    it('inlines nested imports and localizes extensionless protocol-relative fonts', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('theme.css'))
          return new Response(
            '@font-face { font-family: Demo; src: url(//1.1.1.1/font?id=2) format("woff2"); }',
            { headers: { 'content-type': 'text/css' } }
          );
        return new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'content-type': 'font/woff2' } });
      }) as typeof fetch;
      const context = { downloaded: [], missing: [], seenUrls: new Set<string>(), seenHashes: new Map() };
      const conversionId = `font-css-${Date.now()}`;
      await conversionStorage.setupConversionWorkspace(conversionId);
      try {
        const css = await assetDownloader.processAndRewriteCss(
          conversionId,
          '@import "https://1.1.1.1/theme.css";',
          'https://1.1.1.1/base.css',
          context
        );
        expect(css).not.toContain('@import');
        expect(css).not.toContain('1.1.1.1/font');
        expect(css).toMatch(/url\("\/fonts\/[^" ]+\.woff2"\)/);
        expect(context.downloaded[0].isFont).toBe(true);
        await expect(
          fs.stat(path.join(conversionStorage.getProjectDir(conversionId), context.downloaded[0].localPath))
        ).resolves.toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
        await conversionStorage.deleteConversion(conversionId);
      }
    });

    it('cleans encoded and entity quotes before resolving CSS assets', async () => {
      const originalFetch = globalThis.fetch;
      const requested: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        requested.push(String(input));
        return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/jpeg' } });
      }) as typeof fetch;
      const context = { downloaded: [], missing: [], seenUrls: new Set<string>(), seenHashes: new Map() };
      const conversionId = `quoted-css-${Date.now()}`;
      await conversionStorage.setupConversionWorkspace(conversionId);
      try {
        const css = await assetDownloader.processAndRewriteCss(
          conversionId,
          '.a{background:url(%22/images/foo.jpg%22)}.b{background:url(&quot;/images/bar.jpg&quot;)}',
          'https://1.1.1.1/site.css',
          context
        );
        expect(requested).toHaveLength(0);
        expect(css).toContain('url("/images/foo.jpg")');
        expect(css).toContain('url("/images/bar.jpg")');
        expect(css).not.toMatch(/%22|&quot;|1\.1\.1\.1\/images/u);
      } finally {
        globalThis.fetch = originalFetch;
        await conversionStorage.deleteConversion(conversionId);
      }
    });

    it('canonicalizes malformed already-local asset URLs without restoring the source host', async () => {
      const originalFetch = globalThis.fetch;
      const requested: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        requested.push(String(input));
        return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'font/woff2' } });
      }) as typeof fetch;
      const context = { downloaded: [], missing: [], seenUrls: new Set<string>(), seenHashes: new Map() };
      try {
        const malformed = ['%22/fonts/demo.woff2%22', '"/fonts/demo.woff2"', '&quot;/fonts/demo.woff2&quot;'];
        for (const value of malformed) {
          const css = await assetDownloader.processAndRewriteCss(
            'test-conv',
            `@font-face { src: url(${value}) format('woff2'); }`,
            'https://source.example/site.css',
            context
          );
          expect(css).toContain('url("/fonts/demo.woff2")');
          expect(css).not.toMatch(/%22|\/%22|source\.example.*\/fonts/u);
        }
        expect(requested).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('localizes exact malformed source font URLs and rejects ambiguous filename fallback', () => {
      const downloaded = [
        {
          originalUrl: 'https://cdn-a.example/fonts/shared.woff2',
          publicUrl: '/fonts/hash-a_shared.woff2',
          localPath: 'public/fonts/hash-a_shared.woff2',
          mimeType: 'font/woff2',
          sizeBytes: 2,
          hash: 'a',
          isSvg: false,
          isFont: true,
          isStylesheet: false,
          isImage: false,
        },
        {
          originalUrl: 'https://cdn-b.example/fonts/shared.woff2',
          publicUrl: '/fonts/hash-b_shared.woff2',
          localPath: 'public/fonts/hash-b_shared.woff2',
          mimeType: 'font/woff2',
          sizeBytes: 2,
          hash: 'b',
          isSvg: false,
          isFont: true,
          isStylesheet: false,
          isImage: false,
        },
      ];
      const internals = assetDownloader as unknown as {
        localizeDownloadedAssetUrls(css: string, assets: typeof downloaded): string;
        sanitizeRemainingRelativeUrls(css: string, baseUrl: string): string;
      };

      const exact = internals.localizeDownloadedAssetUrls(
        '.a{src:url(https://cdn-a.example/%22/fonts/shared.woff2%22)}',
        downloaded
      );
      expect(exact).toBe('.a{src:url("/fonts/hash-a_shared.woff2")}');

      const ambiguous = internals.localizeDownloadedAssetUrls(
        '.b{src:url(https://unknown.example/fonts/shared.woff2)}',
        downloaded
      );
      expect(ambiguous).toContain('https://unknown.example/fonts/shared.woff2');
      expect(ambiguous).not.toContain('/fonts/hash-a_shared.woff2');
      expect(ambiguous).not.toContain('/fonts/hash-b_shared.woff2');

      const sanitized = internals.sanitizeRemainingRelativeUrls(
        '.c{src:url(%22/fonts/hash-a_shared.woff2%22)}',
        'https://source.example/site.css'
      );
      expect(sanitized).toBe('.c{src:url("/fonts/hash-a_shared.woff2")}');
    });

    it('rewrites relative font URLs in CSS to prevent Next.js webpack resolution errors', async () => {
      const rawCss =
        "@font-face { font-family: Geist; src: url(../media/fef07dbb0973bf53-s.3p2_lha1f2xer.woff2) format('woff2'); }";
      const dummyContext = {
        downloaded: [],
        missing: [],
        seenUrls: new Set<string>(),
        seenHashes: new Map(),
      };

      const rewritten = await assetDownloader.processAndRewriteCss(
        'test-conv',
        rawCss,
        'https://example.com/_next/static/css/styles.css',
        dummyContext
      );

      // Should not contain '../media/' which causes Module not found
      expect(rewritten).not.toContain('../media/');
      // Should have resolved relative URL against base to absolute or public
      expect(
        rewritten.includes('https://example.com/_next/static/media/fef07dbb0973bf53-s.3p2_lha1f2xer.woff2') ||
          rewritten.includes('/fonts/')
      ).toBe(true);
    });
  });
});
