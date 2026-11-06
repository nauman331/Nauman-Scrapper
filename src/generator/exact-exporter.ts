import path from 'node:path';
import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import { conversionStorage } from './storage.js';
import { assetCollector } from './assets/asset-collector.js';
import { assetDownloader } from './assets/asset-downloader.js';
import { HtmlNavigation } from './html-navigation.js';
import { buildPageInventory, type RawScrapePageItem } from './inventory/page-inventory.js';
import { sanitizeGeneratedCss } from './css-sanitizer.js';
import type { ExactConversionOptions, ExactStageId } from './exact-types.js';
import { mapHtmlPageFiles, htmlAssetPath } from './html-project-structure.js';
import { cssUrlPattern, unquoteCssUrl } from './assets/css-urls.js';
import { format } from 'prettier';
import { HtmlSvgProcessor } from './assets/svg-processor.js';
import { cleanupExactSnapshot } from './exact-cleanup.js';

const URL_ATTRIBUTES = new Set(['href', 'src', 'poster', 'xlink:href', 'background', 'data-src', 'data-lazy-src', 'data-original']);
const dangerousUrl = (value: string) => /^(?:javascript|vbscript|file|blob):/i.test(value.replace(/[\u0000-\u0020]/g, '')) || /^data:(?!image\/(?:png|gif|jpeg|webp|avif|bmp|x-icon)(?:;|,))/i.test(value.trim());

/** Preserve presentation hooks, but never source executable behavior. */
export function sanitizeExactHtml(html: string, warnings: string[]): string {
  const $ = cheerio.load(html);
  if ($('script, iframe, object, embed, applet').length) warnings.push('Source scripts and embedded executable documents were removed; script-driven features are unavailable.');
  $('script, iframe, object, embed, applet, base').remove();
  $('meta[http-equiv]').each((_, element) => {
    if (/^(?:refresh|content-security-policy|set-cookie)$/i.test($(element).attr('http-equiv') || '')) $(element).remove();
  });
  $('link').each((_, element) => {
    if (/^(?:modulepreload|prefetch|preconnect|dns-prefetch|manifest)$/i.test($(element).attr('rel') || '') || /^(?:script|document)$/i.test($(element).attr('as') || '')) $(element).remove();
  });
  $('*').each((_, element) => {
    if (!('attribs' in element)) return;
    const node = $(element);
    for (const [name, value] of Object.entries(element.attribs || {})) {
      if (/^on/i.test(name) || ['srcdoc', 'action', 'formaction', 'ping'].includes(name) || (URL_ATTRIBUTES.has(name) && dangerousUrl(value))) {
        node.removeAttr(name);
        warnings.push('Executable handlers, unsafe URLs or source form submission endpoints were removed.');
      }
      if (name === 'style') node.attr(name, safeCss(value, warnings, true, false, true));
    }
    if (element.tagName === 'form') {
      node.attr('inert', '');
      warnings.push('Source forms are displayed but inert: backend submission, search, authentication and checkout are not implemented.');
    }
  });
  $('style').each((_, element) => { $(element).text(safeCss($(element).text(), warnings, false, true)); });
  return $.html();
}

function safeCss(css: string, warnings: string[], inline = false, preserveImports = false, preserveFormatting = false): string {
  try {
    const root = postcss.parse(inline ? `x{${css}}` : css);
    root.walkDecls((decl) => {
      const decoded = decl.value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\/\*[\s\S]*?\*\//g, '');
      if (/expression\s*\(|(?:javascript|vbscript|file):|behavior\s*:/i.test(decoded) || /^(-moz-binding|behavior)$/i.test(decl.prop)) {
        decl.remove(); warnings.push('Unsafe CSS declaration removed.');
      }
    });
    root.walkAtRules((rule) => {
      if ((/^import$/i.test(rule.name) && !preserveImports) || /^(?:tailwind|apply|config|plugin)$/i.test(rule.name)) { rule.remove(); warnings.push('Unresolved CSS import or source build directive removed.'); }
    });
    if (inline && preserveFormatting && root.toString() === `x{${css}}`) return css;
    return inline ? (root.first as postcss.Rule)?.nodes?.map((node) => node.toString()).join(';') || '' : root.toString();
  } catch {
    warnings.push('Malformed CSS was omitted because it could not be safely parsed.');
    return '';
  }
}

export function relativeExactOutputUrl(fromFile: string, toFile: string): string {
  return path.posix.relative(path.posix.dirname(fromFile), toFile) || path.posix.basename(toFile);
}

export async function exportExactHtml(input: {
  conversionId: string; jobId: string; targetUrl: string; domain: string; pages: RawScrapePageItem[]; options: ExactConversionOptions;
  stage?: (id: ExactStageId, message: string) => void;
}) {
  const { conversionId, jobId, targetUrl, domain, options } = input;
  const warnings: string[] = ['Static snapshot export only; source JavaScript and backend features are not reproduced. Visual fidelity is not guaranteed.'];
  const sameSite = input.pages.filter((page) => new URL(page.url).origin === new URL(targetUrl).origin);
  let pages = options.pages ? sameSite.filter((page) => options.pages!.includes(page.url)) : sameSite;
  if (options.pages?.some((url) => !pages.some((page) => page.url === url))) throw new Error('One or more selected pages are missing from the bounded same-site snapshot.');
  if (options.cloneMode === 'single') {
    if (options.pages && options.pages.length !== 1) throw new Error('Single clone mode requires exactly one selected page.');
    pages = [pages.find((page) => page.url === targetUrl) || pages[0]].filter((page): page is RawScrapePageItem => Boolean(page));
  }
  if (!pages.length) throw new Error('No captured same-site HTML pages are available. Run a scrape first.');
  if (pages.some((page) => !page.rawData?.html?.trim())) throw new Error('A selected page has an empty HTML snapshot; scrape it with HTML capture enabled.');
  if (options.cloneMode === 'full') warnings.push('Full mode exports only selected captured same-site pages, bounded to 500 results; it does not crawl additional pages.');
  if (options.preserveInteractivity) warnings.push('preserveInteractivity applies only to native HTML controls; scripts remain stripped and forms remain inert.');
  input.stage?.('build-page-inventory', 'Mapping captured pages to standalone HTML files');
  const inventory = buildPageInventory(jobId, targetUrl, domain, pages);
  const pageFiles = mapHtmlPageFiles(pages.map(page => page.url), targetUrl);
  const navigation = new HtmlNavigation(pageFiles, targetUrl);
  const stats = { declarationsSeen: 0, declarationsConverted: 0, declarationsPreserved: 0, inlineDeclarationsConverted: 0, sourceClassesRemoved: 0 };
  const missingAssets: string[] = [];
  let totalFiles = 0;
  const copied = new Set<string>();
  const svgProcessor = new HtmlSvgProcessor(conversionId, warnings);
  let removedWidgets = 0;
  await conversionStorage.setupConversionWorkspace(conversionId);
  for (const [index, page] of pages.entries()) {
    const output = pageFiles[index];
    const source = cheerio.load(page.rawData!.html!);
    let baseUrl = page.url;
    try { baseUrl = new URL(source('base[href]').attr('href') || page.url, page.url).href; } catch { warnings.push('Invalid source base URL ignored.'); }
    const runtimeStyles = source('style[data-styled], style[data-emotion]').toArray();
    if (runtimeStyles.length && runtimeStyles.every(element => !source(element).text().trim())) {
      throw new Error('This saved snapshot has empty CSS-in-JS styles. Re-scrape this URL with PLAYWRIGHT to capture runtime stylesheet rules before exporting.');
    }
    const cleaned = cleanupExactSnapshot(page.rawData!.html!, warnings);
    removedWidgets += cleaned.removed;
    const sanitized = sanitizeExactHtml(cleaned.html, warnings);
    input.stage?.('resolve-assets', `Resolving assets for ${page.url}`);
    const discovered = assetCollector.collectAssets(sanitized, baseUrl).filter((asset) => asset.type !== 'animation');
    const extra = cheerio.load(sanitized);
    extra('video[src], audio[src], use[href], use[xlink\\:href]').each((_, element) => {
      const raw = extra(element).attr('src') || extra(element).attr('href') || extra(element).attr('xlink:href');
      if (raw && !raw.startsWith('#')) {
        const url = new URL(raw, baseUrl);
        discovered.push({ originalUrl: url.href, sourcePageUrl: baseUrl, type: 'other', suggestedLocalName: url.pathname.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'media' });
      }
    });
    const resolved = await assetDownloader.resolveAssets(conversionId, discovered, assetCollector.collectInlineStyles(sanitized).map((css) => ({ css, sourceUrl: baseUrl })), { generatedPublicAssetUrls: false });
    // Resolve nested imports without moving inline styles out of their cascade position.
    const exactInlineStyles: string[] = [];
    const context = { downloaded: resolved.downloadedAssets, missing: resolved.missingAssets,
      seenUrls: new Set<string>(), seenHashes: new Map(resolved.downloadedAssets.map(asset => [asset.hash, asset])), generatedPublicAssetUrls: false };
    for (const element of extra('style').toArray()) {
      exactInlineStyles.push(await assetDownloader.processAndRewriteCss(conversionId, extra(element).text(), baseUrl, context));
    }
    missingAssets.push(...resolved.missingAssets);
    const assetMap = new Map<string, string>();
    for (const asset of resolved.downloadedAssets) {
      const local = asset.publicUrl.replace(/^\//, '');
      if (!/^(?:images|fonts|icons|css|animations)\/[a-zA-Z0-9._-]+$/.test(local)) throw new Error('Unsafe downloaded asset path.');
      const target = htmlAssetPath(asset);
      assetMap.set(asset.originalUrl, target);
      assetMap.set(asset.publicUrl, target);
    }
    const localUrl = (raw: string, fromFile: string, isNavigation = false): string => {
      if (!raw || raw.startsWith('#')) return raw;
      if (isNavigation && !/^https?:/i.test(raw) && /^[a-z][a-z\d+.-]*:/i.test(raw.trim())) return '#';
      if (/^(?:data:|mailto:|tel:)/i.test(raw)) return dangerousUrl(raw) ? '' : raw;
      let absolute: URL;
      try { absolute = new URL(raw, baseUrl); } catch { warnings.push(`Unresolved URL: ${raw}`); return ''; }
      if (!/^https?:$/.test(absolute.protocol)) return '';
      const asset = assetMap.get(raw) || assetMap.get(absolute.href);
      if (asset) return relativeExactOutputUrl(fromFile, asset) + absolute.hash;
      if (isNavigation) {
        const destination = navigation.resolve(absolute, fromFile);
        if (destination) {
          if (destination.missing) warnings.push(`Uncaptured source-site link disabled: ${absolute.href}`);
          return destination.href;
        }
        warnings.push(`External navigation disabled: ${absolute.href}`);
        return '#';
      } else warnings.push(`External asset not localized: ${absolute.href}`);
      return absolute.href;
    };
    const rewriteCss = (css: string, fromFile: string) => safeCss(css, warnings).replace(cssUrlPattern(), (full, raw: string) => /^(?:data:|blob:|#)/i.test(unquoteCssUrl(raw)) ? full : `url("${localUrl(unquoteCssUrl(raw), fromFile).replace(/"/g, '%22')}")`);
    const svgStylesheets = new Map<string, string>();
    for (const asset of resolved.downloadedAssets) {
      const target = assetMap.get(asset.publicUrl)!;
      if (asset.isStylesheet) {
        const css = await fs.readFile(path.join(conversionStorage.getProjectDir(conversionId), asset.localPath), 'utf8');
        svgStylesheets.set(relativeExactOutputUrl(output.path, target), rewriteCss(sanitizeGeneratedCss(css, { strategy: 'original' }), output.path));
      }
      if (copied.has(target)) continue;
      let buffer = await fs.readFile(path.join(conversionStorage.getProjectDir(conversionId), asset.localPath));
      if (asset.isStylesheet) buffer = Buffer.from(rewriteCss(sanitizeGeneratedCss(buffer.toString('utf8'), { strategy: 'original' }), target));
      else if (asset.isSvg) buffer = Buffer.from(sanitizeExactHtml(buffer.toString('utf8'), warnings).match(/<svg[\s\S]*?<\/svg>/i)?.[0] || '<svg xmlns="http://www.w3.org/2000/svg"/>');
      else if (/javascript|text\/html|application\/xhtml/i.test(asset.mimeType) || /<(?:!doctype\s+html|html|script)\b/i.test(buffer.subarray(0, 1024).toString('utf8'))) {
        warnings.push(`Unsafe asset content omitted: ${asset.originalUrl}`); missingAssets.push(asset.originalUrl); continue;
      }
      await conversionStorage.writeFileSafe(conversionId, target, buffer);
      if (asset.isSvg) svgProcessor.registerAsset(target, buffer.toString('utf8'));
      copied.add(target); totalFiles++;
    }
    input.stage?.('generate-html-files', `Preserving HTML, source classes and CSS for ${page.url}`);
    const $ = cheerio.load(sanitized);
    if (!options.preserveMetadata) $('meta:not([charset]), link[rel="canonical"], title').remove();
    $('*').each((_, element) => {
      if (!('attribs' in element)) return;
      const node = $(element);
      for (const [name, raw] of Object.entries(element.attribs || {})) {
        if (URL_ATTRIBUTES.has(name)) {
          const isNavigation = (element.tagName === 'a' || element.tagName === 'area') && (name === 'href' || name === 'xlink:href');
          node.attr(name, localUrl(raw, output.path, isNavigation));
          if (isNavigation) {
            node.removeAttr('target');
            const rewritten = node.attr(name);
            if (raw && !raw.startsWith('#') && (!rewritten || rewritten === '#')) {
              node.attr(name, '#').attr('aria-disabled', 'true').attr('data-unavailable-route', 'true');
              node.attr('title', 'This destination is not available in the converted website.');
              node.attr('inert', '');
              warnings.push('Navigation without a local destination was disabled.');
            }
          } else if ((name === 'href' || name === 'xlink:href') && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(node.attr(name) || '')) {
            node.removeAttr(name);
            warnings.push('Unlocalized external href removed.');
          }
        }
        if (/^(?:srcset|data-srcset|data-lazy-srcset)$/.test(name) && !raw.startsWith('data:')) node.attr(name, raw.split(',').map((candidate) => { const [url, ...descriptor] = candidate.trim().split(/\s+/); return [localUrl(url, output.path), ...descriptor].join(' '); }).join(', '));
        if (name === 'style') node.attr(name, raw.replace(cssUrlPattern(), (full, url: string) => /^(?:data:|blob:|#)/i.test(unquoteCssUrl(url)) ? full : `url("${localUrl(unquoteCssUrl(url), output.path).replace(/"/g, '%22')}")`));
        if (name === 'content' && element.tagName === 'meta' && /image/i.test(node.attr('property') || node.attr('name') || '')) node.attr(name, localUrl(raw, output.path));
      }
    });
    $('img, picture source, figure source:not(video source, audio source)').each((_, element) => {
      const node = $(element);
      if ((!node.attr('src') || /^data:|^about:/.test(node.attr('src') || '')) && node.attr('data-src')) node.attr('src', node.attr('data-src')!);
      if (!node.attr('srcset') && node.attr('data-srcset')) node.attr('srcset', node.attr('data-srcset')!);
      if (element.tagName === 'source' && node.closest('picture').length && !node.attr('srcset') && node.attr('src')) node.attr('srcset', node.attr('src')!);
    });
    $('figure').each((_, element) => {
      const figure = $(element);
      if (figure.find('img, picture, video, audio').length) return;
      const source = figure.find('source').first();
      const srcset = source.attr('srcset');
      const src = source.attr('src') || srcset?.trim().split(/\s+/)[0];
      if (!src) return;
      const image = $('<img>').attr('src', src).attr('alt', source.attr('alt') || '');
      if (srcset) image.attr('srcset', srcset);
      source.after(image);
    });
    $('style').each((styleIndex, element) => { $(element).text(rewriteCss(sanitizeGeneratedCss(exactInlineStyles[styleIndex], { strategy: 'original' }), output.path)); });
    const recoveredSourceCss = sanitizeGeneratedCss(resolved.consolidatedCss, { strategy: 'original' });
    if (recoveredSourceCss !== resolved.consolidatedCss) warnings.push('Malformed source CSS rules were repaired before preservation.');
    const sourceCss = safeCss(recoveredSourceCss, warnings);
    if (resolved.consolidatedCss.trim() && !sourceCss.trim()) throw new Error('Source stylesheet processing produced no CSS. Export stopped to avoid an unstyled project.');
    if (discovered.some(asset => asset.type === 'stylesheet') && !sourceCss.trim()) throw new Error('No original stylesheets could be loaded. Export stopped; check stylesheet download errors and re-scrape the page.');
    const svgSourceCss: string[] = [];
    $('style, link[rel="stylesheet"]').each((_, element) => {
      const node = $(element);
      const css = element.tagName === 'style' ? node.text() : svgStylesheets.get(node.attr('href') || '') || '';
      const media = node.attr('media');
      svgSourceCss.push(media ? `@media ${media}{${css}}` : css);
    });
    const svgHtml = await svgProcessor.process($.html(), svgSourceCss.join('\n'), output.path, page.rawData!.html!);
    input.stage?.('preserve-source-css', `Preserving source CSS for ${page.url}; no Tailwind compilation`);
    await conversionStorage.writeFileSafe(conversionId, output.cssPath, '\n');
    const finalHtml = '<!doctype html>\n' + sanitizeExactHtml(svgHtml.replace(/^<!doctype[^>]*>/i, ''), warnings);
    await conversionStorage.writeFileSafe(conversionId, output.path, await format(finalHtml, {
      parser: 'html', htmlWhitespaceSensitivity: 'strict', embeddedLanguageFormatting: 'off', printWidth: 100,
    }));
    totalFiles += 2;
  }
  await conversionStorage.writeFileSafe(conversionId, 'README.md', `# ${options.projectName}\n\nOpen index.html or serve this folder with a static web server. No installation or CSS build is required.\n\nSource classes, safe inline styles and original CSS cascade layers are preserved. Inline SVG artwork is extracted to reusable assets/svgs/ images with source paint, selectors and fragment dependencies materialized; geometry is retained with minimal SVG cleanup. Page-driven SVG scripting, interactive paint and internal links cannot operate across an image boundary. Recognized blocking/transient/ad widgets are removed before asset collection and document scrolling is restored. Cleanup cannot recover overlay-hidden content absent from the captured snapshot. Final HTML is formatted without reformatting embedded CSS. Already compiled Tailwind CSS, when captured, is retained as source CSS without migration or recompilation. Stylesheet links and style elements keep their source ordering and media attributes; downloaded assets are localized.\n\nThis is a static snapshot, not an executable copy. Source scripts, event handlers and unsafe URLs are removed; forms are inert. Login, search, checkout and other backend or JavaScript-driven features are not recreated. Only selected captured same-site pages are included. Review export warnings for missing resources and visual limitations.\n`);
  totalFiles++;
  // Shared download storage uses public/; exact bundles contain relocated root assets only.
  await fs.rm(path.join(conversionStorage.getProjectDir(conversionId), 'public'), { recursive: true, force: true });
  totalFiles += svgProcessor.stats.assetsCreated;
  warnings.push(`Exact snapshot cleanup removed ${removedWidgets} recognized blocking/transient/ad widget(s) across ${pages.length} page(s).`);
  warnings.push(...missingAssets.map((asset) => `Missing asset: ${asset}`));
  return { inventory, pageFiles, svgStats: svgProcessor.stats, removedWidgets, conversionStats: stats, warnings: [...new Set(warnings)], missingAssets: [...new Set(missingAssets)], totalFilesGenerated: totalFiles };
}
