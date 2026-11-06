import path from 'node:path';
import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { format } from 'prettier';
import selectorParser from 'postcss-selector-parser';

import { conversionStorage } from './storage.js';
import { assetCollector } from './assets/asset-collector.js';
import { assetDownloader } from './assets/asset-downloader.js';
import { HtmlSvgProcessor } from './assets/svg-processor.js';
import { HtmlNavigation } from './html-navigation.js';
import { convertDocumentsToTailwind, type TailwindConversionResult } from './analyzer/tailwind-converter.js';
import { buildPageInventory, type RawScrapePageItem } from './inventory/page-inventory.js';
import { sanitizeGeneratedCss } from './css-sanitizer.js';
import type { HtmlConversionOptions, HtmlStageId } from './html-types.js';
import { mapHtmlPageFiles, htmlAssetPath } from './html-project-structure.js';
import { cssUrlPattern, unquoteCssUrl } from './assets/css-urls.js';
import { convertDocumentToCoreCss } from './analyzer/core-css-converter.js';
import { proxyService } from '../proxies/proxy.service.js';

// Pin the runtime to the compiler version; do not mix v3 utility semantics with v4.
export const TAILWIND_BROWSER_URL = 'https://cdn.tailwindcss.com/3.4.17';
export const TAILWIND_BROWSER_CONFIG = 'tailwind.config = { corePlugins: { preflight: false } };';

const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'poster',
  'xlink:href',
  'background',
  'data-src',
  'data-lazy-src',
  'data-original',
]);
const dangerousUrl = (value: string) =>
  /^(?:javascript|vbscript|file|blob):/i.test(value.replace(/[\u0000-\u0020]/g, '')) ||
  /^data:(?!image\/(?:png|gif|jpeg|webp|avif|bmp|x-icon)(?:;|,))/i.test(value.trim());

/** Removes executable source behavior, while retaining native details, anchors and controls. */
export function sanitizeStandaloneHtml(html: string, warnings: string[], overlayGuard = false): string {
  const $ = cheerio.load(html);
  // Source scripts are stripped below, so their dismiss/consent handlers cannot
  // work. Omit transient UI rather than shipping a permanently blocking overlay.
  const transientName =
    /(?:^|[\s_-])(?:popup|pop-up|modal|overlay|backdrop|cookie[-_ ]?(?:banner|notice|consent|bar)|consent[-_ ]?(?:banner|notice|modal)|(?:newsletter|offer|dmca)[-_ ]?(?:popup|modal|banner|notice))(?:$|[\s_-])/i;
  const vendorName =
    /^(?:onetrust-(?:banner-sdk|consent-sdk|pc-sdk)|CybotCookiebotDialog(?:BodyUnderlay)?|cookie-law-info-bar|cookie-notice|cmplz-cookiebanner|didomi-host|iubenda-cs-banner)$/i;
  let removedTransient = false;
  $('body *').each((_, element) => {
    if (!('attribs' in element) || ['script', 'style', 'template'].includes(element.tagName)) return;
    const node = $(element);
    const names = [node.attr('id') || '', node.attr('class') || ''].join(' ');
    const semantic =
      element.tagName === 'dialog' ||
      ['dialog', 'alertdialog'].includes(node.attr('role') || '') ||
      node.attr('aria-modal') === 'true';
    const named =
      transientName.test(names) ||
      vendorName.test(node.attr('id') || '') ||
      Object.keys(element.attribs).some((name) =>
        /^(?:data-cookie-banner|data-consent-banner|data-popup|data-modal)$/.test(name)
      );
    // Opaque consent components may have no modal/cookie class. Require notice
    // wording AND controls AND overlay evidence, not just a privacy link in content.
    const text = node.text().replace(/\s+/g, ' ');
    const privacyText =
      /your privacy choices|privacy preferences|manage (?:your )?consent|accept (?:all )?cookies|we use cookies/i.test(
        text
      );
    const overlayEvidence =
      /position\s*:\s*(?:fixed|sticky)/i.test(node.attr('style') || '') ||
      /privacy choices|privacy preferences|cookie|consent/i.test(node.attr('aria-label') || '');
    const privacyNotice =
      text.length < 10000 &&
      privacyText &&
      overlayEvidence &&
      node.find('button,[role="button"],input[type="button"],input[type="submit"]').length > 0;
    if (!semantic && !named && !privacyNotice && node.attr('data-captured-transient-ui') !== 'true') return;
    // Never remove the document layout because a body/main wrapper carries a hook.
    if (['main', 'header', 'footer', 'nav'].includes(element.tagName)) return;
    node.remove();
    removedTransient = true;
  });
  if (removedTransient) {
    warnings.push(
      'Pop-ups, modal overlays and cookie/consent notices were omitted because source dismissal handlers are unavailable in static exports.'
    );
    $('html, body').each((_, element) => {
      const node = $(element);
      const classes = (node.attr('class') || '')
        .split(/\s+/)
        .filter(
          (name) =>
            !/^(?:modal-open|popup-open|no-scroll|noscroll|scroll-locked|overflow-hidden)$/i.test(name)
        );
      node.attr('class', classes.join(' '));
      // Restore scrolling on the static clone, not on the source page.
      node.attr('style', (node.attr('style') || '') + ';overflow:auto!important;overflow-y:auto!important;');
    });
  }
  if ($('script, iframe, object, embed, applet').length)
    warnings.push(
      'Source scripts and embedded executable documents were removed; script-driven features are unavailable.'
    );
  $('script, iframe, object, embed, applet, base').remove();
  $('meta[http-equiv]').each((_, element) => {
    if (/^(?:refresh|content-security-policy|set-cookie)$/i.test($(element).attr('http-equiv') || ''))
      $(element).remove();
  });
  $('link').each((_, element) => {
    if (
      /^(?:modulepreload|prefetch|preconnect|dns-prefetch|manifest)$/i.test($(element).attr('rel') || '') ||
      /^(?:script|document)$/i.test($(element).attr('as') || '')
    )
      $(element).remove();
  });
  $('*').each((_, element) => {
    if (!('attribs' in element)) return;
    const node = $(element);
    for (const [name, value] of Object.entries(element.attribs || {})) {
      if (
        /^on/i.test(name) ||
        ['srcdoc', 'action', 'formaction', 'ping'].includes(name) ||
        (URL_ATTRIBUTES.has(name) && dangerousUrl(value))
      ) {
        node.removeAttr(name);
        warnings.push('Executable handlers, unsafe URLs or source form submission endpoints were removed.');
      }
      if (name === 'style') node.attr(name, safeCss(value, warnings, true));
    }
    if (element.tagName === 'form') {
      node.attr('inert', '');
      warnings.push(
        'Source forms are displayed but inert: backend submission, search, authentication and checkout are not implemented.'
      );
    }
  });
  $('style').each((_, element) => {
    $(element).text(safeCss($(element).text(), warnings, false, true));
  });
  // Defense in depth for recognized overlays. display:none removes their layout
  // and hit testing even when snapshot paint forces opacity/visibility to visible.
  if (overlayGuard && !$('style[data-static-overlay-guard]').length) {
    $('head').append(
      '<style data-static-overlay-guard>dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"],[data-captured-transient-ui="true"],#onetrust-banner-sdk,#onetrust-consent-sdk,#onetrust-pc-sdk,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#didomi-host,.cookie-banner,.cookie-consent,.cookie-notice,.privacy-modal,.privacy-choices-modal,.modal-backdrop{display:none!important;pointer-events:none!important}</style>'
    );
  }
  return $.html();
}

function safeCss(css: string, warnings: string[], inline = false, preserveImports = false): string {
  try {
    const root = postcss.parse(inline ? `x{${css}}` : css);
    root.walkDecls((decl) => {
      const decoded = decl.value
        .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\/\*[\s\S]*?\*\//g, '');
      if (
        /expression\s*\(|(?:javascript|vbscript|file):|behavior\s*:/i.test(decoded) ||
        /^(-moz-binding|behavior)$/i.test(decl.prop)
      ) {
        decl.remove();
        warnings.push('Unsafe CSS declaration removed.');
      }
    });
    root.walkAtRules((rule) => {
      if (
        (/^import$/i.test(rule.name) && !preserveImports) ||
        /^(?:tailwind|apply|config|plugin)$/i.test(rule.name)
      ) {
        rule.remove();
        warnings.push('Unresolved CSS import or source build directive removed.');
      }
    });
    return inline
      ? (root.first as postcss.Rule)?.nodes?.map((node) => node.toString()).join(';') || ''
      : root.toString();
  } catch {
    warnings.push('Malformed CSS was omitted because it could not be safely parsed.');
    return '';
  }
}

export function relativeOutputUrl(fromFile: string, toFile: string): string {
  return path.posix.relative(path.posix.dirname(fromFile), toFile) || path.posix.basename(toFile);
}

/** Move residual inline declarations out only after Tailwind migration and URL rewriting. */
export function externalizeInlineStyles(
  html: string,
  sourceCss: string,
  namespace: string
): { html: string; css: string } {
  const $ = cheerio.load(html);
  const rules: string[] = [];
  const usedClasses = new Set(
    $('[class]')
      .toArray()
      .flatMap((element) => ($(element).attr('class') || '').split(/\s+/))
  );
  // Inline author specificity exceeds selectors in source styles. Preserve that
  // precedence without promoting normal declarations above source !important.
  let maxIds = 0;
  try {
    postcss.parse(sourceCss).walkRules((rule) => {
      maxIds = Math.max(maxIds, (rule.selector.match(/#[\w-]+/g) || []).length);
    });
  } catch {
    /* Source CSS is validated separately by the exporter. */
  }
  const seen = new Map<string, string>();
  let sequence = 0;
  $('[style]').each((_, element) => {
    const node = $(element);
    const inline = node.attr('style') || '';
    if (!inline.trim()) {
      node.removeAttr('style');
      return;
    }
    const parsed = postcss.parse(`x{${inline}}`);
    const rule = parsed.first as postcss.Rule;
    const declarations =
      rule.nodes
        ?.filter((item) => item.type === 'decl')
        .map((item) => item.toString())
        .join('; ') || '';
    if (!declarations) {
      node.removeAttr('style');
      return;
    }
    let className = seen.get(declarations);
    if (!className) {
      do {
        className = `converted-inline-${namespace}-${++sequence}`;
      } while (usedClasses.has(className));
      usedClasses.add(className);
      seen.set(declarations, className);
      // :is() adds specificity without requiring a particular DOM ancestry or ID.
      // The class branch always matches; the generated ID branch is never needed.
      const specificity = `:is(#${className}-priority,.${className})`.repeat(maxIds + 1);
      rules.push(`.${className}${specificity} { ${declarations}; }`);
    }
    node.attr('class', [node.attr('class'), className].filter(Boolean).join(' '));
    node.removeAttr('style');
  });
  return {
    html: $.html(),
    css: rules.length ? `/* converted from inline CSS to external CSS */\n${rules.join('\n')}\n` : '',
  };
}

export async function exportStandaloneHtml(input: {
  conversionId: string;
  jobId: string;
  targetUrl: string;
  domain: string;
  pages: RawScrapePageItem[];
  options: HtmlConversionOptions;
  stage?: (id: HtmlStageId, message: string) => void;
}) {
  const { conversionId, jobId, targetUrl, domain, options } = input;
  let proxyUrl: string | undefined;
  if (options.useProxy) {
    if (!options.proxyId) throw new Error('Select a saved proxy when proxy routing is enabled.');
    proxyUrl = (await proxyService.resolveUrl(options.proxyId)) ?? undefined;
    if (!proxyUrl)
      throw new Error('The selected proxy no longer exists. Select another proxy before converting.');
  }
  const warnings: string[] = [
    'Static snapshot export only; source JavaScript and backend features are not reproduced. Visual fidelity is not guaranteed.',
  ];
  const sameSite = input.pages.filter((page) => new URL(page.url).origin === new URL(targetUrl).origin);
  let pages = options.pages ? sameSite.filter((page) => options.pages!.includes(page.url)) : sameSite;
  if (options.pages?.some((url) => !pages.some((page) => page.url === url)))
    throw new Error('One or more selected pages are missing from the bounded same-site snapshot.');
  if (options.cloneMode === 'single') {
    if (options.pages && options.pages.length !== 1)
      throw new Error('Single clone mode requires exactly one selected page.');
    pages = [pages.find((page) => page.url === targetUrl) || pages[0]].filter(
      (page): page is RawScrapePageItem => Boolean(page)
    );
  }
  if (!pages.length) throw new Error('No captured same-site HTML pages are available. Run a scrape first.');
  if (pages.some((page) => !page.rawData?.html?.trim()))
    throw new Error('A selected page has an empty HTML snapshot; scrape it with HTML capture enabled.');
  if (options.cloneMode === 'full')
    warnings.push(
      'Full mode exports only selected captured same-site pages, bounded to 500 results; it does not crawl additional pages.'
    );
  if (options.preserveInteractivity)
    warnings.push(
      'preserveInteractivity applies only to native HTML controls; scripts remain stripped and forms remain inert.'
    );
  input.stage?.('build-page-inventory', 'Mapping captured pages to standalone HTML files');
  const inventory = buildPageInventory(jobId, targetUrl, domain, pages);
  const isCoreCss = options.cssStrategy === 'core';
  const pageFiles = mapHtmlPageFiles(
    pages.map((page) => page.url),
    targetUrl
  );
  if (isCoreCss) pageFiles[0].cssPath = 'css/core.css';
  const navigation = new HtmlNavigation(pageFiles, targetUrl);
  const stats: TailwindConversionResult['stats'] = {
    declarationsSeen: 0,
    declarationsConverted: 0,
    declarationsPreserved: 0,
    inlineDeclarationsConverted: 0,
    sourceClassesRemoved: 0,
  };
  const missingAssets: string[] = [];
  let totalFiles = 0;
  const copied = new Set<string>();
  const svgProcessor = new HtmlSvgProcessor(conversionId, warnings);
  const tailwindPreviewCss: Record<string, string> = {};
  await conversionStorage.setupConversionWorkspace(conversionId);
  for (const [index, page] of pages.entries()) {
    const output = pageFiles[index];
    const source = cheerio.load(page.rawData!.html!);
    let baseUrl = page.url;
    try {
      baseUrl = new URL(source('base[href]').attr('href') || page.url, page.url).href;
    } catch {
      warnings.push('Invalid source base URL ignored.');
    }
    const runtimeStyles = source('style[data-styled], style[data-emotion]').toArray();
    if (runtimeStyles.length && runtimeStyles.every((element) => !source(element).text().trim())) {
      throw new Error(
        'This saved snapshot has empty CSS-in-JS styles. Re-scrape this URL with PLAYWRIGHT to capture runtime stylesheet rules before exporting.'
      );
    }
    const sanitized = sanitizeStandaloneHtml(page.rawData!.html!, warnings);
    input.stage?.('resolve-assets', `Resolving assets for ${page.url}`);
    const discovered = assetCollector
      .collectAssets(sanitized, baseUrl)
      .filter((asset) => asset.type !== 'animation');
    // rel is a token list, not necessarily the literal string "stylesheet".
    if (!isCoreCss)
      source('link[rel~="stylesheet"]').each((_, element) => {
        const href = source(element).attr('href');
        if (!href) return;
        const url = new URL(href, baseUrl).href;
        if (!discovered.some((asset) => asset.originalUrl === url))
          discovered.push({
            originalUrl: url,
            sourcePageUrl: baseUrl,
            type: 'stylesheet',
            suggestedLocalName: 'stylesheet.css',
          });
      });
    const extra = cheerio.load(sanitized);
    extra('video[src], audio[src], use[href], use[xlink\\:href]').each((_, element) => {
      const raw =
        extra(element).attr('src') || extra(element).attr('href') || extra(element).attr('xlink:href');
      if (raw && !raw.startsWith('#')) {
        const url = new URL(raw, baseUrl);
        discovered.push({
          originalUrl: url.href,
          sourcePageUrl: baseUrl,
          type: 'other',
          suggestedLocalName:
            url.pathname
              .split('/')
              .pop()
              ?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'media',
        });
      }
    });
    const cssSources: Array<{
      asset?: (typeof discovered)[number];
      css?: string;
      sourceUrl: string;
      media?: string;
    }> = [];
    if (!isCoreCss)
      extra('style, link[rel~="stylesheet"]').each((_, element) => {
        const node = extra(element);
        const media = node.attr('media');
        if (element.tagName === 'style') cssSources.push({ css: node.text(), sourceUrl: baseUrl, media });
        else {
          const url = new URL(node.attr('href') || '', baseUrl).href;
          const asset = discovered.find((item) => item.originalUrl === url && item.type === 'stylesheet');
          if (asset) cssSources.push({ asset, sourceUrl: baseUrl, media });
        }
      });
    const resolved = await assetDownloader.resolveAssets(
      conversionId,
      discovered,
      assetCollector.collectInlineStyles(sanitized).map((css) => ({ css, sourceUrl: baseUrl })),
      {
        generatedPublicAssetUrls: false,
        ...(proxyUrl ? { proxyUrl } : {}),
        ...(!isCoreCss ? { cssSources } : {}),
      }
    );
    missingAssets.push(...resolved.missingAssets);
    if (
      !isCoreCss &&
      resolved.missingAssets.some((missing) =>
        cssSources.some(
          (source) =>
            source.asset &&
            (missing === source.asset.originalUrl || missing.startsWith(source.asset.originalUrl + ' ('))
        )
      )
    ) {
      throw new Error(
        'A required source stylesheet could not be loaded. Re-scrape with PLAYWRIGHT to capture browser-loaded CSS before exporting Tailwind.'
      );
    }
    const assetMap = new Map<string, string>();
    for (const asset of resolved.downloadedAssets) {
      // Stylesheet content is already consolidated for Tailwind/residual output.
      // Raw downloaded copies are temporary inputs, not runtime project assets.
      if (asset.isStylesheet || (!isCoreCss && asset.isFont)) continue;
      const local = asset.publicUrl.replace(/^\//, '');
      if (!/^(?:images|fonts|icons|css|animations)\/[a-zA-Z0-9._-]+$/.test(local))
        throw new Error('Unsafe downloaded asset path.');
      const target = htmlAssetPath(asset);
      assetMap.set(asset.originalUrl, target);
      assetMap.set(asset.publicUrl, target);
    }
    const localUrl = (raw: string, fromFile: string, isNavigation = false): string => {
      if (!raw || raw.startsWith('#')) return raw;
      if (isNavigation && !/^https?:/i.test(raw) && /^[a-z][a-z\d+.-]*:/i.test(raw.trim())) return '#';
      if (/^(?:data:|mailto:|tel:)/i.test(raw)) return dangerousUrl(raw) ? '' : raw;
      let absolute: URL;
      try {
        absolute = new URL(raw, baseUrl);
      } catch {
        warnings.push(`Unresolved URL: ${raw}`);
        return '';
      }
      if (!/^https?:$/.test(absolute.protocol)) return '';
      const asset = assetMap.get(raw) || assetMap.get(absolute.href);
      if (asset) return relativeOutputUrl(fromFile, asset) + absolute.hash;
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
    const rewriteCss = (css: string, fromFile: string) =>
      safeCss(css, warnings).replace(cssUrlPattern(), (full, raw: string) =>
        /^(?:data:|blob:|#)/i.test(unquoteCssUrl(raw))
          ? full
          : `url("${localUrl(unquoteCssUrl(raw), fromFile).replace(/"/g, '%22')}")`
      );
    for (const asset of resolved.downloadedAssets) {
      if (asset.isStylesheet || (!isCoreCss && asset.isFont)) continue;
      const target = assetMap.get(asset.publicUrl)!;
      if (copied.has(target)) continue;
      let buffer = await fs.readFile(
        path.join(conversionStorage.getProjectDir(conversionId), asset.localPath)
      );
      if (asset.isSvg)
        buffer = Buffer.from(
          sanitizeStandaloneHtml(buffer.toString('utf8'), warnings).match(/<svg[\s\S]*?<\/svg>/i)?.[0] ||
            '<svg xmlns="http://www.w3.org/2000/svg"/>'
        );
      // Do not ship responses containing standalone executable HTML or scripts disguised as media.
      else if (
        /javascript|text\/html|application\/xhtml/i.test(asset.mimeType) ||
        /<(?:!doctype\s+html|html|script)\b/i.test(buffer.subarray(0, 1024).toString('utf8'))
      ) {
        warnings.push(`Unsafe asset content omitted: ${asset.originalUrl}`);
        missingAssets.push(asset.originalUrl);
        continue;
      }
      await conversionStorage.writeFileSafe(conversionId, target, buffer);
      if (asset.isSvg) svgProcessor.registerAsset(target, buffer.toString('utf8'));
      copied.add(target);
      totalFiles++;
    }
    input.stage?.(
      'generate-html-files',
      isCoreCss
        ? `Externalizing Core CSS for ${page.url}`
        : `Converting ${page.url} to element-level Tailwind utilities`
    );
    const $ = cheerio.load(sanitized);
    $('style, link[rel~="stylesheet"], link[as="style"]').remove();
    if (!options.preserveMetadata) $('meta:not([charset]), link[rel="canonical"], title').remove();
    $('*').each((_, element) => {
      if (!('attribs' in element)) return;
      const node = $(element);
      for (const [name, raw] of Object.entries(element.attribs || {})) {
        if (URL_ATTRIBUTES.has(name)) {
          const isNavigation =
            (element.tagName === 'a' || element.tagName === 'area') &&
            (name === 'href' || name === 'xlink:href');
          node.attr(name, localUrl(raw, output.path, isNavigation));
          if (isNavigation) {
            // Never let source targets escape the local preview, even for fragments.
            node.removeAttr('target');
            const rewritten = node.attr(name);
            if (raw && !raw.startsWith('#') && (!rewritten || rewritten === '#')) {
              node.attr(name, '#').attr('aria-disabled', 'true').attr('data-unavailable-route', 'true');
              node.attr('title', 'This destination is not available in the converted website.');
              node.attr('inert', '');
              warnings.push('Navigation without a local destination was disabled.');
            }
          } else if (
            (name === 'href' || name === 'xlink:href') &&
            /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(node.attr(name) || '')
          ) {
            // Canonical/alternate/resource hrefs must not retain remote addresses.
            // Downloaded resources have already been rewritten to local paths.
            node.removeAttr(name);
            warnings.push('Unlocalized external href removed.');
          }
        }
        if (/^(?:srcset|data-srcset|data-lazy-srcset)$/.test(name) && !raw.startsWith('data:'))
          node.attr(
            name,
            raw
              .split(',')
              .map((candidate) => {
                const [url, ...descriptor] = candidate.trim().split(/\s+/);
                return [localUrl(url, output.path), ...descriptor].join(' ');
              })
              .join(', ')
          );
        if (name === 'style')
          node.attr(
            name,
            raw.replace(cssUrlPattern(), (full, url: string) =>
              /^(?:data:|blob:|#)/i.test(unquoteCssUrl(url))
                ? full
                : `url("${localUrl(unquoteCssUrl(url), isCoreCss ? output.cssPath : output.path).replace(/"/g, '%22')}")`
            )
          );
        if (
          name === 'content' &&
          element.tagName === 'meta' &&
          /image/i.test(node.attr('property') || node.attr('name') || '')
        )
          node.attr(name, localUrl(raw, output.path));
      }
    });
    // Promote lazy images before removing source lazy-loader attributes.
    $('img, picture source, figure source:not(video source, audio source)').each((_, element) => {
      const node = $(element);
      if ((!node.attr('src') || /^data:|^about:/.test(node.attr('src') || '')) && node.attr('data-src'))
        node.attr('src', node.attr('data-src')!);
      if (!node.attr('srcset') && node.attr('data-srcset')) node.attr('srcset', node.attr('data-srcset')!);
      // Browser picture sources use srcset, not src. Retain src for mapping/debugging.
      if (
        element.tagName === 'source' &&
        node.closest('picture').length &&
        !node.attr('srcset') &&
        node.attr('src')
      )
        node.attr('srcset', node.attr('src')!);
    });
    // A source directly under figure is not rendered by browsers. Supply a
    // native image fallback only when that figure has no existing image/media.
    $('figure').each((_, element) => {
      const figure = $(element);
      if (figure.find('img, picture, video, audio').length) return;
      const source = figure.find('source').first();
      const srcset = source.attr('srcset');
      const src = source.attr('src') || srcset?.trim().split(/\s+/)[0];
      if (!src) return;
      const image = $('<img>')
        .attr('src', src)
        .attr('alt', source.attr('alt') || '');
      if (srcset) image.attr('srcset', srcset);
      source.after(image);
    });
    const recoveredSourceCss = sanitizeGeneratedCss(resolved.consolidatedCss, {
      strategy: isCoreCss ? 'original' : 'tailwind',
    });
    if (recoveredSourceCss !== resolved.consolidatedCss)
      warnings.push(
        isCoreCss
          ? 'Malformed source CSS rules were repaired before Core CSS conversion.'
          : 'Malformed source CSS rules were repaired before Tailwind conversion.'
      );
    const sourceCss = safeCss(recoveredSourceCss, warnings);
    if (resolved.consolidatedCss.trim() && !sourceCss.trim())
      throw new Error(
        'Source stylesheet processing produced no CSS. Export stopped to avoid an unstyled project.'
      );
    if (isCoreCss) {
      if (discovered.some((asset) => asset.type === 'stylesheet') && !sourceCss.trim())
        throw new Error(
          'No original stylesheets could be loaded. Export stopped; check stylesheet download errors and re-scrape the page.'
        );
      // Keep SVG structure and source classes: external images would break page
      // selectors, inherited paint and interactive CSS inside the SVG.
      const final = cheerio.load(sanitizeStandaloneHtml($.html(), warnings));
      final('head').append(
        `<link rel="stylesheet" href="${relativeOutputUrl(output.path, output.cssPath)}">`
      );
      // The last sanitizer can restore scrolling via style attributes, so convert
      // after it, in this existing HTML-generation stage (no command required).
      const converted = convertDocumentToCoreCss(final.html(), rewriteCss(sourceCss, output.cssPath));
      for (const name of Object.keys(stats) as Array<keyof typeof stats>)
        stats[name] += converted.stats[name];
      await conversionStorage.writeFileSafe(conversionId, output.cssPath, converted.css);
      await conversionStorage.writeFileSafe(
        conversionId,
        output.path,
        '<!doctype html>\n' + converted.html.replace(/^<!doctype[^>]*>/i, '')
      );
      totalFiles += 2;
      continue;
    }
    // Analyze original CSS before migration erases SVG selectors or moves paint
    // declarations into utility classes. Extraction must not break those dependencies.
    const svgHtml = await svgProcessor.process($.html(), sourceCss, output.path, page.rawData!.html!, {
      tailwindOnly: true,
    });
    // Sanitize before conversion: the sanitizer can add scrolling overrides.
    // CDN utilities render in the document, so asset URLs are page-relative.
    const prepared = cheerio.load(sanitizeStandaloneHtml(svgHtml, warnings));
    // CDN scans the entire DOM. Namespace source hooks before conversion so
    // legacy names such as container/flex/p-4 cannot become accidental utilities.
    const sourceNames = new Map<string, string>();
    prepared('[class]').each((_, element) => {
      const names = (prepared(element).attr('class') || '').split(/\s+/).filter(Boolean);
      names.forEach((name) => {
        if (!sourceNames.has(name)) sourceNames.set(name, `source-${sourceNames.size}`);
      });
      prepared(element).attr('class', names.map((name) => sourceNames.get(name)).join(' '));
    });
    const namespacedCss = postcss.parse(rewriteCss(sourceCss, output.path));
    namespacedCss.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
      try {
        rule.selector = selectorParser((selectors) =>
          selectors.walkClasses((node) => {
            const replacement = sourceNames.get(node.value);
            if (replacement) node.value = replacement;
          })
        ).processSync(rule.selector);
      } catch {
        /* The converter reports unsupported selector syntax. */
      }
    });
    const migrated = convertDocumentsToTailwind(
      [{ id: String(index), html: prepared.html() }],
      namespacedCss.toString(),
      { strict: true }
    );
    for (const name of Object.keys(stats) as Array<keyof typeof stats>) stats[name] += migrated.stats[name];
    // A complex page can produce hundreds of thousands of warnings. Never
    // spread a data-sized array into function arguments (V8 has an argument cap).
    for (const warning of migrated.warnings) warnings.push(warning.message);
    input.stage?.('compile-tailwind', `Preparing CDN utilities and isolated preview for ${page.url}`);
    // Private, script-free dashboard preview; never included in the ZIP.
    const compiled = await postcss([
      tailwindcss({ content: [], safelist: migrated.utilities || [], corePlugins: { preflight: false } }),
    ]).process('@tailwind utilities;', { from: undefined });
    tailwindPreviewCss[output.path] = compiled.css;
    if (discovered.some((asset) => asset.type === 'stylesheet') && !sourceCss.trim())
      throw new Error(
        'No original stylesheets could be loaded. Export stopped; check stylesheet download errors and re-scrape the page.'
      );
    output.cssPath = '';
    const final = cheerio.load(migrated.documents[0].html);
    const generatedUtilities = new Set(migrated.utilities || []);
    const retainedRelationships = new Set<string>();
    generatedUtilities.forEach((utility) => {
      for (const match of utility.matchAll(/\.source-(\d+)/g))
        retainedRelationships.add(`source-${match[1]}`);
    });
    final('[class]').each((_, element) => {
      const classes = (final(element).attr('class') || '')
        .split(/\s+/)
        .filter((name) => !/^source-\d+$/.test(name) || retainedRelationships.has(name));
      if (classes.length) final(element).attr('class', classes.join(' '));
      else final(element).removeAttr('class');
    });
    final('head').append(
      `<script src="${TAILWIND_BROWSER_URL}"></script><script>${TAILWIND_BROWSER_CONFIG}</script>`
    );
    if (final('[style], style').length || migrated.residualCss.trim())
      throw new Error('Tailwind-only output validation failed: original styling remains.');
    await conversionStorage.writeFileSafe(
      conversionId,
      output.path,
      await format('<!doctype html>\n' + final.html().replace(/^<!doctype[^>]*>/i, ''), {
        parser: 'html',
        printWidth: 120,
        htmlWhitespaceSensitivity: 'strict',
      })
    );
    totalFiles++;
  }
  if (!isCoreCss) {
    await fs.writeFile(
      path.join(conversionStorage.getConversionDir(conversionId), 'tailwind-preview.json'),
      JSON.stringify(tailwindPreviewCss)
    );
    warnings.push(
      'Tailwind CDN export requires internet access. The browser generates Tailwind CSS at runtime; no CSS folder or build tooling is included.'
    );
  }
  // Download reuse writes to Next.js public/; HTML bundles contain only relocated root assets.
  await fs.rm(path.join(conversionStorage.getProjectDir(conversionId), 'public'), {
    recursive: true,
    force: true,
  });
  totalFiles += svgProcessor.stats.assetsCreated;
  for (const asset of missingAssets) warnings.push(`Missing asset: ${asset}`);
  return {
    inventory,
    pageFiles,
    svgStats: svgProcessor.stats,
    conversionStats: stats,
    warnings: [...new Set(warnings)],
    missingAssets: [...new Set(missingAssets)],
    totalFilesGenerated: totalFiles,
  };
}
