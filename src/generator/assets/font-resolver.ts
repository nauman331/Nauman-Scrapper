import postcss, { type AtRule, type ChildNode } from 'postcss';
import { assetDownloader } from './asset-downloader.js';
import type { DownloadedAsset } from '../types.js';

/** Fonts are resources, not element utilities. Keep every descriptor and enclosing condition. */
export function splitFontDefinitions(css: string): { fontCss: string; utilityCss: string } {
  const root = postcss.parse(css);
  const fonts = postcss.root();
  const selectFonts = (nodes: ChildNode[]): ChildNode[] => nodes.flatMap(node => {
    if (node.type !== 'atrule') return [];
    if (node.name.toLowerCase() === 'font-face') return [node.clone()];
    if (!node.nodes) return [];
    const children = selectFonts(node.nodes);
    if (!children.length) return [];
    const wrapper = node.clone();
    wrapper.removeAll();
    children.forEach(child => wrapper.append(child));
    return [wrapper];
  });
  selectFonts(root.nodes).forEach(node => fonts.append(node));
  root.walkAtRules('font-face', rule => { rule.remove(); });
  return { fontCss: fonts.toString(), utilityCss: root.toString() };
}

const descriptor = (rule: AtRule, name: string) => {
  const node = rule.nodes?.find(node => node.type === 'decl' && node.prop.toLowerCase() === name);
  return node?.type === 'decl' ? node.value : '';
};
const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Prefer the actual Google family when available; never substitute an unrelated font. */
export async function resolveGoogleFontDefinitions(
  conversionId: string,
  fontCss: string,
  proxyUrl?: string
): Promise<{ fontCss: string; downloadedAssets: DownloadedAsset[] }> {
  const root = postcss.parse(fontCss);
  const groups = new Map<string, AtRule[]>();
  root.walkAtRules('font-face', rule => {
    // Metric-adjusted next/font fallbacks and local-only system fonts must remain unchanged.
    if (!/url\(/i.test(descriptor(rule, 'src'))) return;
    const family = unquote(descriptor(rule, 'font-family'));
    if (!family || /fallback|^__|[{};]|\b(?:icon|awesome|material symbols)\b/i.test(family)) return;
    const rules = groups.get(family) || [];
    rules.push(rule);
    groups.set(family, rules);
  });
  const downloadedAssets: DownloadedAsset[] = [];
  for (const [family, rules] of groups) {
    // Conditional/layered registrations cannot be flattened without altering font selection.
    if (rules.some(rule => rule.parent?.type !== 'root' || rule.nodes?.some(node =>
      node.type === 'decl' && /^(?:font-stretch|size-adjust|ascent-override|descent-override|line-gap-override)$/.test(node.prop)
    ))) continue;
    const weights = rules.flatMap(rule => {
      const weight = descriptor(rule, 'font-weight') || '400';
      return weight === 'normal' ? [400] : weight === 'bold' ? [700] : weight.split(/\s+/).map(Number);
    });
    if (weights.some(weight => !Number.isFinite(weight) || weight < 1 || weight > 1000)) continue;
    const styles = new Set(rules.map(rule => descriptor(rule, 'font-style') || 'normal'));
    if ([...styles].some(style => !['normal', 'italic'].includes(style))) continue;
    // Google family names are case-sensitive; framework-generated names commonly use lowercase.
    const googleFamily = family.replace(/\b[a-z]/g, letter => letter.toUpperCase());
    const min = Math.min(...weights), max = Math.max(...weights);
    const variable = rules.some(rule => /\d+\s+\d+/.test(descriptor(rule, 'font-weight')));
    const weightQuery = variable ? `${min}..${max}` : [...new Set(weights)].sort((a, b) => a - b).join(';');
    const axes = styles.has('italic') ? 'ital,wght' : 'wght';
    const values = styles.has('italic')
      ? [...styles].sort((a, b) => Number(a === 'italic') - Number(b === 'italic')).map(style => weightQuery.split(';').map(weight => `${style === 'italic' ? 1 : 0},${weight}`).join(';')).join(';')
      : weightQuery;
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(googleFamily).replace(/%20/g, '+')}:${axes}@${values}&display=swap`;
    const result = await assetDownloader.resolveAssets(conversionId, [{
      originalUrl: url, sourcePageUrl: url, type: 'stylesheet', suggestedLocalName: 'google-font.css',
    }], [], { generatedPublicAssetUrls: false, ...(proxyUrl ? { proxyUrl } : {}) });
    if (result.missingAssets.length || !result.consolidatedCss.trim()) continue;
    const googleRoot = postcss.parse(result.consolidatedCss);
    const googleRules: AtRule[] = [];
    googleRoot.walkAtRules('font-face', rule => { googleRules.push(rule); });
    if (!googleRules.length || googleRules.some(rule => unquote(descriptor(rule, 'font-family')).toLowerCase() !== family.toLowerCase())) continue;
    for (const rule of googleRules) {
      rule.walkDecls('font-family', declaration => { declaration.value = JSON.stringify(family); });
      rules[0].before(rule.clone());
    }
    rules.forEach(rule => rule.remove());
    downloadedAssets.push(...result.downloadedAssets);
  }
  return { fontCss: root.toString(), downloadedAssets };
}
