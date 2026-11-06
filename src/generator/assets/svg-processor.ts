import path from 'node:path';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import { optimize } from 'svgo';
import { conversionStorage } from '../storage.js';

const INHERITED = /^(?:fill|stroke(?:-.*)?|color|visibility|font(?:-.*)?|text-anchor|--.*)$/i;
const LAYOUT = /^(?:display|position|inset(?:-.*)?|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|margin(?:-.*)?|padding(?:-.*)?|flex(?:-.*)?|align-self|justify-self|order|vertical-align|z-index)$/i;

/** One instance per export: all inline SVGs become reusable external images. */
export class HtmlSvgProcessor {
  private readonly assets = new Map<string, string>();
  readonly stats = { detected: 0, optimized: 0, extracted: 0, keptInline: 0, reused: 0, assetsCreated: 0 };

  constructor(private readonly conversionId: string, private readonly warnings: string[]) {}

  private optimizedMarkup(markup: string): string {
    // Keep geometry, IDs, styles, animation targets and responsive viewBox intact.
    return optimize(markup, {
      multipass: false,
      plugins: ['removeXMLProcInst', 'removeDoctype', 'removeComments', 'cleanupAttrs', 'sortAttrs'],
    }).data;
  }

  registerAsset(assetPath: string, markup: string): void {
    // The requested directory is also enforced for reused downloaded assets.
    if (!assetPath.startsWith('assets/svgs/')) return;
    try { this.assets.set(this.optimizedMarkup(markup), assetPath); }
    catch { /* Extraction can still serialize valid SVG XML without SVGO. */ }
  }

  async process(html: string, css: string, pagePath: string, originalHtml: string, options: { tailwindOnly?: boolean } = {}): Promise<string> {
    const $ = cheerio.load(html);
    const referencesDocument = cheerio.load(html);
    let stylesheet: postcss.Root | null = null;
    try { stylesheet = postcss.parse(css); }
    catch { this.warnings.push(`SVG stylesheet dependencies could not be parsed in ${pagePath}.`); }
    const roots = $('svg').toArray().filter(node => !$(node).parents('svg').length);
    const sourceHasScripts = cheerio.load(originalHtml)('script').length > 0;

    for (const element of roots) {
      const svg = $(element);
      this.stats.detected++;
      // CSS-dependent artwork must stay in the HTML so the shared Tailwind
      // utilities can style it. Extracting it would hide source CSS in SVG files.
      if (options.tailwindOnly && (svg.find('style, [style]').length || svg.attr('style') !== undefined || css.trim())) {
        this.stats.keptInline++;
        continue;
      }
      // Work on XML so foreign-content attribute casing and namespaces survive.
      const asset = cheerio.load($.html(svg), { xmlMode: true });
      const assetRoot = asset('svg').first();
      assetRoot.attr('xmlns', 'http://www.w3.org/2000/svg');
      assetRoot.attr('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      const originalNodes = [element, ...svg.find('*').toArray()];
      const assetNodes = [assetRoot.get(0)!, ...assetRoot.find('*').toArray()];
      const inherited = new Map<string, string>();
      const image = $('<img>');
      const layout: string[] = [];
      const embedded = postcss.root();

      // Materialize document-context selectors into SVG-local selectors. Retain
      // @media/@supports and keyframes rather than flattening responsive rules.
      stylesheet?.walkRules(rule => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
        const targets: string[] = [];
        try {
          originalNodes.forEach((node, index) => {
            if (!$(node).is(rule.selector)) return;
            asset(assetNodes[index]).attr('data-svg-node', String(index));
            targets.push(`[data-svg-node="${index}"]`);
            if (index === 0) rule.walkDecls(decl => {
              if (LAYOUT.test(decl.prop)) layout.push(`${decl.prop}:${decl.value}${decl.important ? ' !important' : ''}`);
            });
          });
          // Paint and variables previously inherited from HTML ancestors must
          // now live in the external SVG document itself.
          if (!targets.length && svg.parents().toArray().some(node => $(node).is(rule.selector))) {
            const declarations = rule.nodes.filter(node => node.type === 'decl' && INHERITED.test(node.prop));
            if (declarations.length) {
              const inheritedRule = rule.clone({ selector: 'svg', nodes: declarations.map(node => node.clone()) });
              this.appendWithConditions(embedded, inheritedRule, rule);
            }
          }
        } catch {
          this.warnings.push(`Unsupported SVG CSS selector in ${pagePath}: ${rule.selector}`);
        }
        if (targets.length) {
          const clone = rule.clone({ selector: targets.join(',') });
          // Root layout is carried by the image, not applied twice inside it.
          if (targets.length === 1 && targets[0] === '[data-svg-node="0"]') {
            clone.walkDecls(decl => { if (LAYOUT.test(decl.prop)) decl.remove(); });
          }
          this.appendWithConditions(embedded, clone, rule);
        }
      });
      stylesheet?.walkAtRules(rule => {
        if (/^(?:.*keyframes|font-face)$/i.test(rule.name)) embedded.append(rule.clone());
      });
      // Inherit presentation attributes and inline paint from nearest ancestors.
      for (const ancestor of svg.parents().toArray().reverse()) {
        const node = $(ancestor);
        if ('attribs' in ancestor) for (const [name, value] of Object.entries(ancestor.attribs)) {
          if (INHERITED.test(name) && !name.startsWith('--')) inherited.set(name, value);
        }
        try { postcss.parse(`x{${node.attr('style') || ''}}`).walkDecls(decl => {
          if (INHERITED.test(decl.prop)) inherited.set(decl.prop, decl.value);
        }); } catch { /* Existing HTML sanitizer reports malformed inline CSS. */ }
      }
      if (inherited.size) {
        const rule = postcss.rule({ selector: 'svg' });
        for (const [prop, value] of inherited) rule.append(postcss.decl({ prop, value }));
        embedded.prepend(rule);
      }
      if (embedded.nodes.length) {
        const style = asset('<style>');
        style.text(embedded.toString());
        // Original SVG-local styles follow the document stylesheet, as before.
        assetRoot.prepend(style);
      }

      // Inline sprite instances can depend on symbols/defs elsewhere in the page.
      // Copy the referenced definitions (including their transitive references).
      const copiedIds = new Set<string>();
      const importReferences = () => {
        const markup = asset.xml();
        const references = [...markup.matchAll(/(?:url\(\s*["']?#|(?:href|xlink:href)=["']#)([^\s"'()<>]+)/g)].map(match => match[1]);
        let added = false;
        for (const id of references) {
          if (copiedIds.has(id) || asset('[id]').toArray().some(node => asset(node).attr('id') === id)) continue;
          copiedIds.add(id);
          const definition = referencesDocument('[id]').toArray().find(node => referencesDocument(node).attr('id') === id);
          if (!definition) { this.warnings.push(`Unresolved SVG fragment #${id} in ${pagePath}.`); continue; }
          let defs = assetRoot.children('defs').first();
          if (!defs.length) { assetRoot.prepend('<defs/>'); defs = assetRoot.children('defs').first(); }
          defs.append(referencesDocument.html(referencesDocument(definition)));
          added = true;
        }
        return added;
      };
      while (importReferences()) { /* Finite document IDs; cycles are bounded by copiedIds. */ }

      // Localized URLs were relative to the HTML page. Rebase them for assets/svgs.
      const rebase = (value: string): string => {
        if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(value)) return value;
        const [file, suffix = ''] = value.split(/(?=[?#])/s, 2);
        return path.posix.relative('assets/svgs', path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), file))) + suffix;
      };
      asset('[href], [xlink\\:href]').each((_, node) => {
        for (const attr of ['href', 'xlink:href']) {
          const value = asset(node).attr(attr);
          if (value) asset(node).attr(attr, rebase(value));
        }
      });
      const rebaseCss = (value: string) => value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_match, _quote: string, url: string) => `url("${rebase(url.trim()).replace(/"/g, '%22')}")`);
      asset('*').each((_, node) => {
        if (!('attribs' in node)) return;
        for (const [name, value] of Object.entries(node.attribs)) {
          if (/url\(/i.test(value)) asset(node).attr(name, rebaseCss(value));
        }
      });
      asset('style').each((_, node) => { asset(node).text(rebaseCss(asset(node).text())); });

      const title = svg.find('title').first().text();
      const labelledBy = (svg.attr('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => $('[id]').toArray().filter(node => $(node).attr('id') === id).map(node => $(node).text()).join(' ')).join(' ');
      image.attr('alt', svg.attr('aria-label') || labelledBy || title || '');
      for (const [name, value] of Object.entries(element.attribs)) {
        if (['id', 'class', 'role', 'width', 'height', 'style', 'tabindex', 'hidden'].includes(name) || /^(?:aria-|data-)/.test(name)) image.attr(name, value);
      }
      if (layout.length) image.attr('style', layout.join(';') + ';' + (svg.attr('style') || ''));
      // Preserve SVG's default 300x150 fallback rather than img's different sizing.
      if (!image.attr('width') && !svg.attr('viewBox') && !layout.some(value => value.startsWith('width:'))) image.attr('width', '300');
      if (!image.attr('height') && !svg.attr('viewBox') && !layout.some(value => value.startsWith('height:'))) image.attr('height', '150');

      let content = asset.xml();
      try { const optimized = this.optimizedMarkup(content); if (optimized !== content) this.stats.optimized++; content = optimized; }
      catch { this.warnings.push(`SVGO could not optimize an SVG in ${pagePath}; unoptimized external SVG retained.`); }
      let assetPath = this.assets.get(content);
      if (assetPath) this.stats.reused++;
      else {
        assetPath = `assets/svgs/svg-${createHash('sha256').update(content).digest('hex')}.svg`;
        await conversionStorage.writeFileSafe(this.conversionId, assetPath, content);
        this.assets.set(content, assetPath);
        this.stats.assetsCreated++;
      }
      image.attr('src', path.posix.relative(path.posix.dirname(pagePath), assetPath));
      svg.replaceWith(image);
      this.stats.extracted++;
      if (sourceHasScripts || svg.find('a').length || /:hover|:focus|currentColor/i.test($.html(svg) + css)) {
        this.warnings.push('All SVGs are external images: page-driven SVG scripting, hover paint and internal SVG links cannot operate across the image boundary.');
      }
    }
    return $.html();
  }

  private appendWithConditions(target: postcss.Root, clone: postcss.Rule, original: postcss.Rule): void {
    let wrapped: postcss.ChildNode = clone;
    for (let parent = original.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule') {
        const condition = postcss.atRule({ name: parent.name, params: parent.params });
        condition.append(wrapped);
        wrapped = condition;
      }
    }
    target.append(wrapped);
  }
}
