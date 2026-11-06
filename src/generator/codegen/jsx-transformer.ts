import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

/** Exact DOM identity: retain text, attributes, comments and tree boundaries. */
export function canonicalDomHash(html: string): string {
  const $ = cheerio.load(html, null, false);
  const canonicalize = (node: AnyNode): unknown => {
    if ('name' in node && 'attribs' in node) {
      return [node.type, node.name, Object.entries(node.attribs).sort(([a], [b]) => a.localeCompare(b)), node.children.map(canonicalize)];
    }
    if ('data' in node) return [node.type, node.data];
    if ('children' in node) return [node.type, node.children.map(canonicalize)];
    return [];
  };
  return crypto.createHash('sha256').update(JSON.stringify($.root().contents().toArray().map(canonicalize))).digest('hex');
}

export interface HtmlToJsxOptions {
  /** Trusted, generated HTML tag names mapped to valid React component identifiers. */
  componentTags?: ReadonlyMap<string, string>;
  /** Generated project source root; omitted for legacy low-level callers. */
  sourceRoot?: 'src';
  /** Share across pages for deterministic, deduplicated generated icon names. */
  svgRegistry?: Map<string, GeneratedSvgAsset>;
}

const ATTRIBUTE_MAP: Record<string, string> = {
  class: 'className', for: 'htmlFor', 'accept-charset': 'acceptCharset', acceptcharset: 'acceptCharset',
  charset: 'charSet', datetime: 'dateTime', 'http-equiv': 'httpEquiv', httpequiv: 'httpEquiv',
  itemid: 'itemID', itemprop: 'itemProp', itemref: 'itemRef', itemscope: 'itemScope', itemtype: 'itemType',
  fetchpriority: 'fetchPriority', referrerpolicy: 'referrerPolicy', playsinline: 'playsInline',
  spellcheck: 'spellCheck', contenteditable: 'contentEditable', tabindex: 'tabIndex', autocomplete: 'autoComplete',
  autofocus: 'autoFocus', readonly: 'readOnly', novalidate: 'noValidate', formnovalidate: 'formNoValidate',
  formaction: 'formAction', formmethod: 'formMethod', formenctype: 'formEncType', formtarget: 'formTarget',
  maxlength: 'maxLength', minlength: 'minLength', cellpadding: 'cellPadding', cellspacing: 'cellSpacing',
  colspan: 'colSpan', rowspan: 'rowSpan', enctype: 'encType', frameborder: 'frameBorder',
  allowfullscreen: 'allowFullScreen', crossorigin: 'crossOrigin', usemap: 'useMap', srcset: 'srcSet', srcdoc: 'srcDoc',
  'enable-background': 'enableBackground', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'clip-path': 'clipPath',
  'fill-opacity': 'fillOpacity', 'flood-color': 'floodColor', 'flood-opacity': 'floodOpacity',
  'color-interpolation': 'colorInterpolation', 'color-interpolation-filters': 'colorInterpolationFilters',
  'dominant-baseline': 'dominantBaseline', 'image-rendering': 'imageRendering', 'marker-end': 'markerEnd',
  'marker-mid': 'markerMid', 'marker-start': 'markerStart', 'shape-rendering': 'shapeRendering',
  'stop-color': 'stopColor', 'stop-opacity': 'stopOpacity', 'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit', 'stroke-opacity': 'strokeOpacity', 'stroke-width': 'strokeWidth',
  'text-anchor': 'textAnchor', 'text-decoration': 'textDecoration', 'vector-effect': 'vectorEffect',
  'xlink:href': 'xlinkHref', 'xmlns:xlink': 'xmlnsXlink', 'xml:space': 'xmlSpace', 'xml:lang': 'xmlLang', 'xml:base': 'xmlBase',
};

export interface GeneratedSvgAsset {
  componentName: string;
  filePath: string;
  code: string;
  hash: string;
}

export interface HtmlToJsxResult {
  jsx: string;
  usesLink: boolean;
  usesLottie: boolean;
  svgAssets: GeneratedSvgAsset[];
}

const JSX_OPEN_BRACE_SENTINEL = '\uE000';
const JSX_CLOSE_BRACE_SENTINEL = '\uE001';
const JSX_STYLE_SENTINEL_PREFIX = '__JSX_STYLE_';

const NUMERIC_JSX_ATTRIBUTES = new Set([
  // React DOM attributes whose typings require numbers.
  'tabIndex', 'rows', 'cols', 'rowSpan', 'colSpan', 'size', 'span', 'start',
  'maxLength', 'minLength', 'high', 'low', 'optimum',
  // Numeric SVG geometry/presentation attributes. Unit-bearing values remain strings.
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'fx', 'fy', 'fr', 'width', 'height', 'pathLength', 'strokeWidth',
  'strokeMiterlimit', 'strokeDashoffset', 'fillOpacity', 'strokeOpacity',
  'stopOpacity', 'floodOpacity',
]);

// Intentionally excludes exponents, leading-dot decimals, Infinity/NaN, and units.
const STRICT_NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function normalizeTypedNumericAttributes(jsx: string): string {
  return jsx.replace(/<\/?[A-Za-z][^<>]*>/g, (tag) => tag.replace(
    /\s([A-Za-z_][\w.-]*)=("([^"]*)"|'([^']*)')/g,
    (attribute, name: string, _quoted: string, doubleValue: string | undefined, singleValue: string | undefined) => {
      if (!NUMERIC_JSX_ATTRIBUTES.has(name)) return attribute;
      const value = doubleValue ?? singleValue ?? '';
      return STRICT_NUMERIC_LITERAL.test(value) ? ` ${name}={${value}}` : attribute;
    },
  ));
}


function normalizeSerializedJsxNamespaces(jsx: string): string {
  return jsx.replace(/<\/?[A-Za-z][^<>]*>/g, (tag) => {
    let normalized = tag.replace(
      /^(<\/?)([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)/,
      (_match, opening: string, _prefix: string, localName: string) => `${opening}${localName}`,
    );

    normalized = normalized.replace(
      /(\s)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)+)(\s*=)/g,
      (_match, whitespace: string, rawName: string, equals: string) => {
        const knownName = ATTRIBUTE_MAP[rawName.toLowerCase()];
        if (knownName) return `${whitespace}${knownName}${equals}`;

        const [first, ...rest] = rawName.split(':').filter(Boolean);
        if (!first) return '';
        const safeName = first + rest
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('');
        return safeName ? `${whitespace}${safeName}${equals}` : '';
      },
    );

    return normalized;
  });
}

const VOID_TAGS = new Set([
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
]);

function selfCloseSerializedVoidTags(jsx: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < jsx.length) {
    const tagStart = jsx.indexOf('<', cursor);
    if (tagStart === -1) return output + jsx.slice(cursor);

    output += jsx.slice(cursor, tagStart);
    if (jsx.startsWith('<!--', tagStart)) {
      const commentEnd = jsx.indexOf('-->', tagStart + 4);
      if (commentEnd === -1) return output + jsx.slice(tagStart);
      output += jsx.slice(tagStart, commentEnd + 3);
      cursor = commentEnd + 3;
      continue;
    }

    const nameMatch = /^<([A-Za-z][\w.-]*)/.exec(jsx.slice(tagStart));
    if (!nameMatch) {
      output += '<';
      cursor = tagStart + 1;
      continue;
    }

    let tagEnd = tagStart + nameMatch[0].length;
    let quote: string | null = null;
    for (; tagEnd < jsx.length; tagEnd += 1) {
      const char = jsx[tagEnd];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }

    if (tagEnd >= jsx.length) return output + jsx.slice(tagStart);

    const serializedTag = jsx.slice(tagStart, tagEnd + 1);
    const tagName = nameMatch[1];
    output += VOID_TAGS.has(tagName) && !/\/\s*>$/.test(serializedTag)
      ? serializedTag.replace(/\s*>$/, ' />')
      : serializedTag;
    cursor = tagEnd + 1;
  }

  return output;
}

export function parseStyleStringToJsxObject(styleStr: string): string {
  if (!styleStr || typeof styleStr !== 'string') return '{}';

  const rules: string[] = [];
  let currentRule = '';
  let quote: string | null = null;
  let parenthesisDepth = 0;
  for (let index = 0; index < styleStr.length; index += 1) {
    const char = styleStr[index];
    const previous = styleStr[index - 1];
    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      parenthesisDepth += 1;
    } else if (char === ')' && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    } else if (char === ';' && parenthesisDepth === 0) {
      if (currentRule.trim()) rules.push(currentRule.trim());
      currentRule = '';
      continue;
    }
    currentRule += char;
  }
  if (currentRule.trim()) rules.push(currentRule.trim());

  const properties: string[] = [];

  for (const rule of rules) {
    const colonIdx = rule.indexOf(':');
    if (colonIdx === -1) continue;

    const rawProp = rule.slice(0, colonIdx).trim();
    let rawVal = rule.slice(colonIdx + 1).trim();

    if (!rawProp || !rawVal) continue;

    // Convert property to camelCase (e.g. background-color -> backgroundColor)
    const camelProp = rawProp.startsWith('--')
      ? `'${rawProp}'`
      : rawProp.replace(/-([a-z0-9])/gi, (_, ch) => ch.toUpperCase());

    // Escape quotes in value
    rawVal = rawVal.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    properties.push(`${camelProp}: '${rawVal}'`);
  }

  const object = `{ ${properties.join(', ')} }`;
  return properties.some((property) => property.startsWith("'--"))
    ? `${object} as import('react').CSSProperties & Record<\`--\${string}\`, string | number>`
    : object;
}

/**
 * Transforms an HTML fragment into valid React TSX/JSX syntax:
 * - Renames attributes to camelCase / JSX standard
 * - Self-closes void elements
 * - Converts style strings to JSX style objects
 * - Removes inline script / event handlers
 * - Rewrites internal links to use <Link>
 */
export function htmlToJsx(rawHtml: string, extractInlineSvgs = true, options: HtmlToJsxOptions = {}): HtmlToJsxResult {
  if (!rawHtml || !rawHtml.trim()) {
    return { jsx: '<div />', usesLink: false, usesLottie: false, svgAssets: [] };
  }

  const $ = cheerio.load(rawHtml, null, false);
  let usesLink = false;
  let usesLottie = false;
  const svgAssets: GeneratedSvgAsset[] = [];
  const svgRegistry = options.svgRegistry ?? (options.sourceRoot ? new Map<string, GeneratedSvgAsset>() : undefined);

  $('[data-animation-type="lottie"][data-src]').each((_, el) => {
    const node = $(el);
    const src = node.attr('data-src');
    if (!src) return;
    usesLottie = true;
    const attributes = [
      `src=${JSON.stringify(src)}`,
      node.attr('class') ? `className=${JSON.stringify(node.attr('class'))}` : '',
      `loop={${node.attr('data-loop') !== '0'}}`,
      `autoplay={${node.attr('data-autoplay') !== '0'}}`,
      `direction={${node.attr('data-direction') === '-1' ? -1 : 1}}`,
      node.attr('aria-label') ? `aria-label=${JSON.stringify(node.attr('aria-label'))}` : '',
      node.attr('aria-hidden') ? `aria-hidden=${JSON.stringify(node.attr('aria-hidden'))}` : '',
    ].filter(Boolean).join(' ');
    node.replaceWith(`<span data-lottie-component="${Buffer.from(attributes).toString('base64')}"></span>`);
  });

  // 1. Remove dangerous script and iframe elements
  $('script, noscript, applet, iframe, next-route-announcer, nextjs-portal').remove();

  // 2. Strip handlers and make copied controls uncontrolled. Cheerio serializes
  // boolean attributes with values; sentinels let us emit idiomatic JSX booleans.
  const booleanAttributes = new Set(['allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'scoped', 'selected']);
  $('*').each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs || {};
    for (const attr of Object.keys(attribs)) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('on')) $(el).removeAttr(attr);
      else if (booleanAttributes.has(lower)) $(el).attr(attr, '__JSX_BOOLEAN__');
    }
  });
  $('input, textarea').each((_, el) => {
    if ($(el).attr('value') !== undefined) {
      $(el).attr('defaultValue', $(el).attr('value') || '');
      $(el).removeAttr('value');
    }
    if ($(el).attr('checked') !== undefined) {
      $(el).attr('defaultChecked', '__JSX_BOOLEAN__');
      $(el).removeAttr('checked');
    }
  });

  // JSX namespace syntax is disabled by modern Next.js. Normalize known namespaced
  // attributes and strip namespace prefixes from unknown names/elements while keeping
  // their values and children intact.
  $('svg, svg *').each((_, el) => {
    const element = el as { tagName?: string; name?: string; attribs?: Record<string, string> };
    if (element.tagName?.includes(':')) {
      element.tagName = element.tagName.split(':').pop() || element.tagName.replaceAll(':', '');
      element.name = element.tagName;
    }
    for (const attr of Object.keys(element.attribs || {})) {
      if (!attr.includes(':') || ATTRIBUTE_MAP[attr.toLowerCase()]) continue;
      const parts = attr.split(':').filter(Boolean);
      const safeName = parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
      if (safeName && safeName !== attr) {
        $(el).attr(safeName, element.attribs![attr]);
        $(el).removeAttr(attr);
      }
    }
  });

  // Extract only inline SVG markup. SVGs referenced by img/source/object URLs remain assets.
  if (extractInlineSvgs) $('svg').each((_, el) => {
    const svgMarkup = $.html(el);
    const hash = crypto.createHash('sha256').update(svgMarkup).digest('hex').slice(0, 12);
    const registry = svgRegistry;
    const existing = registry?.get(hash);
    const componentName = existing?.componentName ?? (options.sourceRoot
      ? `GeneratedIcon${(registry?.size ?? svgAssets.length) + 1}`
      : `Svg${hash.charAt(0).toUpperCase()}${hash.slice(1)}`);
    const componentJsx = htmlToJsx(svgMarkup, false).jsx;
    const asset = existing ?? {
      componentName,
      filePath: options.sourceRoot ? `src/components/icons/generated/${componentName}.tsx` : `assets/svg/${componentName}.tsx`,
      hash,
      code: `import type { SVGProps } from 'react';\n\nexport type ${componentName}Props = SVGProps<SVGSVGElement>;\n\nexport function ${componentName}(props: ${componentName}Props) {\n  return (\n    ${componentJsx.replace('<svg', '<svg {...props}')}\n  );\n}\n\nexport default ${componentName};\n`,
    };
    registry?.set(hash, asset);
    if (!svgAssets.some((item) => item.hash === hash)) svgAssets.push(asset);
    $(el).replaceWith(`<span data-inline-svg-component="${componentName}"></span>`);
  });

  // 3. Mark internal links to use Next.js <Link>
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && (href.startsWith('/') || href.startsWith('#'))) {
      usesLink = true;
      // Change tag to Link
      el.tagName = 'Link';
    }
  });

  // Escape literal braces in text nodes before serialization. In JSX, raw `{` and `}`
  // delimit JavaScript expressions, so copied code samples such as `createServer({})`
  // otherwise make the generated TSX fail to parse. Sentinels keep attribute and
  // generated JSX syntax untouched and are converted to HTML entities afterwards.
  $('*').contents().each((_, node) => {
    if (node.type === 'text') {
      node.data = node.data
        .replaceAll('{', JSX_OPEN_BRACE_SENTINEL)
        .replaceAll('}', JSX_CLOSE_BRACE_SENTINEL);
    }
  });

  // Convert styles from DOM attribute values, before serialization can entity-encode
  // embedded quotes. Sentinels make replacement independent of attribute formatting.
  const serializedStyles: string[] = [];
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const styleIndex = serializedStyles.push(parseStyleStringToJsxObject(style)) - 1;
    $(el).attr('style', `${JSX_STYLE_SENTINEL_PREFIX}${styleIndex}__`);
  });

  // Only explicit, generator-owned placeholders become React component tags.
  for (const [tagName, componentName] of options.componentTags || []) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(componentName)) throw new Error('Invalid generated component name');
    $(tagName).each((_, el) => { if ('tagName' in el) el.tagName = componentName; });
  }

  // Render transformed HTML
  let output = $.html()
    .replaceAll(JSX_OPEN_BRACE_SENTINEL, '&#123;')
    .replaceAll(JSX_CLOSE_BRACE_SENTINEL, '&#125;');

  output = output.replace(
    /<span data-inline-svg-component="([A-Za-z0-9]+)"><\/span>/g,
    '<$1 />'
  );
  output = output.replace(
    /<span data-lottie-component="([A-Za-z0-9+/=]+)"><\/span>/g,
    (_match, encoded: string) => `<LottieAsset ${Buffer.from(encoded, 'base64').toString('utf8')} />`
  );

  // Replace HTML comments <!-- ... --> with JSX {/* ... */}
  output = output.replace(/<!--([\s\S]*?)-->/g, '{/* $1 */}');

  // Restore structurally captured style attributes as JSX objects.
  output = output.replace(/\sstyle=["']__JSX_STYLE_(\d+)__["']/g, (_, rawIndex: string) => {
    const jsxObj = serializedStyles[Number(rawIndex)] || '{}';
    return ` style={${jsxObj}}`;
  });

  // Convert source attributes while preserving data-* and aria-* spellings.
  for (const [htmlAttr, jsxAttr] of Object.entries(ATTRIBUTE_MAP)) {
    const regex = new RegExp(`\\s${htmlAttr}=`, 'gi');
    output = output.replace(regex, ` ${jsxAttr}=`);
  }
  output = output
    .replace(/\sdefaultvalue=/gi, ' defaultValue=')
    .replace(/\sdefaultchecked=/gi, ' defaultChecked=')
    .replace(/=(["'])__JSX_BOOLEAN__\1/g, '={true}');

  // React types distinguish numeric DOM/SVG props from arbitrary string attributes.
  // Keep this allowlisted so ARIA, data attributes, IDs, paths, viewBox, and units are untouched.
  output = normalizeTypedNumericAttributes(output);

  // Cheerio normalizes malformed HTML structure. Its HTML serializer intentionally omits
  // slashes on void elements, so finish those tags with a quote-aware scanner. Tag-name
  // matching remains case-sensitive, keeping React components such as <Link> untouched.
  output = selfCloseSerializedVoidTags(output);

  // Last-resort guard over serialized tags only. This cannot rewrite ordinary text or
  // URL values, but prevents parser-specific namespace syntax reaching TSX assets.
  output = normalizeSerializedJsxNamespaces(output);

  return { jsx: output, usesLink, usesLottie, svgAssets };
}



