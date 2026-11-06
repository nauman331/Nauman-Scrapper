import * as cheerio from 'cheerio';
import postcss from 'postcss';
import type { TailwindConversionResult } from './tailwind-converter.js';

export const CORE_CSS_COMMENT = '/* it is converted from inline CSS to external CSS */';

/** Externalize sanitized declarations without migrating source selectors or utilities. */
export function convertDocumentToCoreCss(html: string, sourceCss: string) {
  const $ = cheerio.load(html);
  const source = postcss.parse(sourceCss);
  // Output is UTF-8 and must start with the required conversion comment.
  source.walkAtRules('charset', rule => { rule.remove(); });
  const stats: TailwindConversionResult['stats'] = {
    declarationsSeen: 0, declarationsConverted: 0, declarationsPreserved: 0,
    inlineDeclarationsConverted: 0, sourceClassesRemoved: 0,
  };
  source.walkDecls(() => { stats.declarationsSeen++; stats.declarationsPreserved++; });
  // Inline specificity outranks every author selector. Use a conservative upper
  // bound, including functional selectors, without adding IDs to the document.
  let idCount = 0;
  source.walkRules(rule => { idCount = Math.max(idCount, (rule.selector.match(/#/g) || []).length); });
  const occupied = html + sourceCss;
  let namespace = 'core-inline';
  while (occupied.includes(namespace)) namespace += '-export';
  const specificity = `:not(#${namespace}-specificity)`.repeat(idCount + 1);
  const priorityLayer = `${namespace}-priority`;
  const normal = postcss.root();
  const important = postcss.atRule({ name: 'layer', params: priorityLayer });
  const groups = new Map<string, { selectors: string[]; declarations: postcss.Declaration[] }>();
  let index = 0;
  $('[style]').each((_, element) => {
    const node = $(element);
    const inline = postcss.parse(`x{${node.attr('style') || ''}}`).first as postcss.Rule;
    node.removeAttr('style');
    const declarations = inline.nodes.filter((child): child is postcss.Declaration => child.type === 'decl');
    if (!declarations.length) return;
    const hint = (node.attr('id') || node.attr('class')?.split(/\s+/)[0] || element.tagName)
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || element.tagName;
    const className = `${namespace}-${hint}-${++index}`;
    node.addClass(className);
    const selector = `.${className}${specificity}`;
    stats.inlineDeclarationsConverted += declarations.length;
    // Each styled element has its own meaningful class; identical declaration
    // lists share a rule, preserving fallback/duplicate declaration order.
    for (const isImportant of [false, true]) {
      const selected = declarations.filter(declaration => Boolean(declaration.important) === isImportant);
      if (!selected.length) continue;
      const key = JSON.stringify(selected.map(declaration => [declaration.prop, declaration.value, Boolean(declaration.important)]));
      const existing = groups.get(key);
      if (existing) existing.selectors.push(selector);
      else groups.set(key, { selectors: [selector], declarations: selected });
    }
  });
  for (const group of groups.values()) {
    const rule = postcss.rule({ selector: group.selectors.join(',\n') });
    for (const declaration of group.declarations) {
      const clone = declaration.clone();
      clone.raws.before = '\n  ';
      clone.raws.between = ': ';
      rule.append(clone);
    }
    rule.raws.after = '\n';
    rule.raws.semicolon = true;
    if (group.declarations[0].important) important.append(rule);
    else normal.append(rule);
  }
  // Important inline declarations outrank even important rules in native layers.
  // First layer wins for !important; normal inline rules remain unlayered.
  const prefix = important.nodes?.length ? `@layer ${priorityLayer};\n` : '';
  return {
    html: $.html(),
    css: `${CORE_CSS_COMMENT}\n${prefix}${source.toString()}\n${normal.toString()}\n${important.nodes?.length ? important.toString() : ''}\n`,
    stats,
  };
}
