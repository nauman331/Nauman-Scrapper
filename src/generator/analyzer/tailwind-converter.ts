import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import * as cheerio from 'cheerio';
import selectorParser from 'postcss-selector-parser';
import postcssNesting from 'postcss-nesting';

type LoadedDocument = ReturnType<typeof cheerio.load>;

export interface TailwindDocumentInput {
  id: string;
  html: string;
}

export interface TailwindConversionWarning {
  selector?: string;
  property?: string;
  message: string;
}

export interface TailwindConversionResult {
  documents: Array<{ id: string; html: string }>;
  residualCss: string;
  /** Exact candidates prevent original framework class names from generating accidental utilities. */
  utilities?: string[];
  warnings: TailwindConversionWarning[];
  stats: {
    declarationsSeen: number;
    declarationsConverted: number;
    declarationsPreserved: number;
    inlineDeclarationsConverted: number;
    sourceClassesRemoved: number;
  };
}

interface SelectorInfo {
  query: string;
  variant: string;
}

interface Candidate {
  declaration: Declaration;
  property: string;
  className: string;
  targets: Array<{ documentIndex: number; element: unknown; key: string }>;
}

const STATIC_VARIANTS: Record<string, string> = {
  hover: 'hover:',
  focus: 'focus:',
  'focus-visible': 'focus-visible:',
  active: 'active:',
  disabled: 'disabled:',
  checked: 'checked:',
};

const EXACT_UTILITIES: Record<string, Record<string, string>> = {
  display: {
    block: 'block',
    inline: 'inline',
    'inline-block': 'inline-block',
    flex: 'flex',
    'inline-flex': 'inline-flex',
    grid: 'grid',
    'inline-grid': 'inline-grid',
    none: 'hidden',
  },
  position: {
    static: 'static',
    fixed: 'fixed',
    absolute: 'absolute',
    relative: 'relative',
    sticky: 'sticky',
  },
  'flex-direction': {
    row: 'flex-row',
    'row-reverse': 'flex-row-reverse',
    column: 'flex-col',
    'column-reverse': 'flex-col-reverse',
  },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  'justify-content': {
    'flex-start': 'justify-start',
    center: 'justify-center',
    'flex-end': 'justify-end',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
  },
  'align-items': {
    'flex-start': 'items-start',
    center: 'items-center',
    'flex-end': 'items-end',
    stretch: 'items-stretch',
    baseline: 'items-baseline',
  },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' },
  'font-weight': {
    '100': 'font-thin',
    '200': 'font-extralight',
    '300': 'font-light',
    '400': 'font-normal',
    normal: 'font-normal',
    '500': 'font-medium',
    '600': 'font-semibold',
    '700': 'font-bold',
    bold: 'font-bold',
    '800': 'font-extrabold',
    '900': 'font-black',
  },
  overflow: {
    auto: 'overflow-auto',
    hidden: 'overflow-hidden',
    clip: 'overflow-clip',
    visible: 'overflow-visible',
    scroll: 'overflow-scroll',
  },
  'object-fit': {
    contain: 'object-contain',
    cover: 'object-cover',
    fill: 'object-fill',
    none: 'object-none',
    'scale-down': 'object-scale-down',
  },
  'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
  'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
  visibility: { visible: 'visible', hidden: 'invisible', collapse: 'collapse' },
  'white-space': {
    normal: 'whitespace-normal',
    nowrap: 'whitespace-nowrap',
    pre: 'whitespace-pre',
    'pre-line': 'whitespace-pre-line',
    'pre-wrap': 'whitespace-pre-wrap',
  },
};

const ARBITRARY_PREFIXES: Record<string, string> = {
  width: 'w',
  height: 'h',
  'min-width': 'min-w',
  'max-width': 'max-w',
  'min-height': 'min-h',
  'max-height': 'max-h',
  margin: 'm',
  'margin-top': 'mt',
  'margin-right': 'mr',
  'margin-bottom': 'mb',
  'margin-left': 'ml',
  padding: 'p',
  'padding-top': 'pt',
  'padding-right': 'pr',
  'padding-bottom': 'pb',
  'padding-left': 'pl',
  gap: 'gap',
  'row-gap': 'gap-y',
  'column-gap': 'gap-x',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  color: 'text',
  'background-color': 'bg',
  'font-size': 'text',
  'line-height': 'leading',
  'letter-spacing': 'tracking',
  'border-radius': 'rounded',
  'border-width': 'border',
  'border-color': 'border',
  opacity: 'opacity',
  'z-index': 'z',
  'grid-template-columns': 'grid-cols',
  'grid-template-rows': 'grid-rows',
  'flex-basis': 'basis',
  'flex-grow': 'grow',
  'flex-shrink': 'shrink',
};

/** Encode Tailwind arbitrary syntax without turning literal underscores into spaces. */
function strictValue(value: string): string {
  // Tailwind intentionally leaves underscores inside url() unchanged. Encode
  // URL whitespace before the general arbitrary-value whitespace conversion.
  const encoded = value.replace(
    /url\(\s*(['"])([\s\S]*?)\1\s*\)/gi,
    (_, quote: string, url: string) => `url(${quote}${url.replace(/\s/g, '%20')}${quote})`
  );
  return encoded
    .trim()
    .replace(/_/g, '\\_')
    .replace(/\s/g, '_')
    .replace(/url\([\s\S]*?\)/gi, (url) => url.replace(/\\_/g, '_'));
}

type Specificity = [number, number, number];
interface StrictCondition {
  kind: 'selector' | 'media' | 'supports' | 'container';
  value: string;
  native?: string;
}
interface StrictCandidate {
  property: string;
  value: string;
  declaration: Declaration;
  inline: boolean;
  specificity: Specificity;
  layer: number[];
  order: number;
  pseudo: string;
  conditions: StrictCondition[];
}

function selectorSpecificity(nodes: readonly selectorParser.Node[]): Specificity {
  const result: Specificity = [0, 0, 0];
  for (const node of nodes) {
    if (node.type === 'id') result[0]++;
    else if (node.type === 'class' || node.type === 'attribute') result[1]++;
    else if (node.type === 'tag') result[2]++;
    else if (node.type === 'pseudo') {
      if (node.value.startsWith('::') || /^:(before|after|first-line|first-letter)$/.test(node.value))
        result[2]++;
      else if (node.value === ':where') continue;
      else if ([':is', ':not', ':has'].includes(node.value)) {
        const maximum = node.nodes
          .map((selector) => selectorSpecificity(selector.nodes))
          .sort(compareSpecificity)
          .at(-1) || [0, 0, 0];
        for (let i = 0; i < 3; i++) result[i] += maximum[i];
      } else result[1]++;
    }
  }
  return result;
}
function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
function compareLayers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    // Unlayered declarations outrank named layers at each nesting level.
    const difference = (a[i] ?? Number.MAX_SAFE_INTEGER) - (b[i] ?? Number.MAX_SAFE_INTEGER);
    if (difference) return difference;
  }
  return 0;
}
function compareStrict(a: StrictCandidate, b: StrictCandidate): number {
  return (
    Number(Boolean(a.declaration.important)) - Number(Boolean(b.declaration.important)) ||
    Number(a.inline) - Number(b.inline) ||
    (a.declaration.important ? -1 : 1) * compareLayers(a.layer, b.layer) ||
    compareSpecificity(a.specificity, b.specificity) ||
    a.order - b.order
  );
}

/** Expand common shorthands before resolving the cascade, not after generating utilities. */
function strictLonghands(property: string, value: string): Array<[string, string]> {
  const words = postcss.list.space(value);
  const sides = ['top', 'right', 'bottom', 'left'];
  if (
    ['margin', 'padding', 'inset', 'border-width', 'border-style', 'border-color'].includes(property) &&
    words.length <= 4
  ) {
    const values = [words[0], words[1] || words[0], words[2] || words[0], words[3] || words[1] || words[0]];
    return sides.map((side, i) => [
      property === 'inset'
        ? side
        : property.startsWith('border-')
          ? `border-${side}-${property.slice(7)}`
          : `${property}-${side}`,
      values[i],
    ]);
  }
  if (property === 'background' && !/var\(/.test(value)) {
    const layers = postcss.list.comma(value);
    const parsed = layers.map((layer) => {
      const parts = postcss.list.split(layer, ['/'], false);
      const tokens = postcss.list.space(parts[0]);
      const image =
        tokens.find((token) =>
          /^(?:none|(?:url|(?:repeating-)?(?:linear|radial|conic)-gradient|image-set)\()/i.test(token)
        ) || 'none';
      const repeat =
        tokens
          .filter((token) => /^(repeat|no-repeat|repeat-x|repeat-y|space|round)$/.test(token))
          .join(' ') || 'repeat';
      const attachment = tokens.find((token) => /^(scroll|fixed|local)$/.test(token)) || 'scroll';
      const boxes = tokens.filter((token) => /^(border-box|padding-box|content-box)$/.test(token));
      const position =
        tokens
          .filter((token) =>
            /^(?:left|right|top|bottom|center|[+-]?[\d.]+(?:%|px|rem|em|vh|vw)?|calc\(.+\))$/.test(token)
          )
          .join(' ') || '0% 0%';
      const known = new Set([
        image,
        ...repeat.split(' '),
        attachment,
        ...boxes,
        ...postcss.list.space(position),
      ]);
      const color = tokens.filter((token) => !known.has(token)).join(' ') || 'transparent';
      const sizeTokens = postcss.list.space(parts[1] || 'auto');
      return {
        image,
        repeat,
        attachment,
        origin: boxes[0] || 'padding-box',
        clip: boxes[1] || boxes[0] || 'border-box',
        position,
        size:
          sizeTokens.filter((token) => !/^(border-box|padding-box|content-box)$/.test(token)).join(' ') ||
          'auto',
        color,
      };
    });
    return [
      ['background-color', parsed.at(-1)!.color],
      ...(['image', 'repeat', 'attachment', 'origin', 'clip', 'position', 'size'] as const).map(
        (part) => [`background-${part}`, parsed.map((layer) => layer[part]).join(', ')] as [string, string]
      ),
    ];
  }
  if (property === 'font' && /^(inherit|initial|unset|revert|revert-layer)$/.test(value)) {
    return [
      'font-family',
      'font-size',
      'font-style',
      'font-weight',
      'font-stretch',
      'font-variant',
      'line-height',
    ].map((prop) => [prop, value]);
  }
  if (property === 'gap' && words.length <= 2)
    return [
      ['row-gap', words[0]],
      ['column-gap', words[1] || words[0]],
    ];
  if (property === 'overflow' && words.length <= 2)
    return [
      ['overflow-x', words[0]],
      ['overflow-y', words[1] || words[0]],
    ];
  if (property === 'flex-flow')
    return [
      ['flex-direction', words.find((word) => /^(row|column)(-reverse)?$/.test(word)) || 'row'],
      ['flex-wrap', words.find((word) => /^(wrap|nowrap|wrap-reverse)$/.test(word)) || 'nowrap'],
    ];
  if (property === 'flex' && !/var\(/.test(value)) {
    if (value === 'none')
      return [
        ['flex-grow', '0'],
        ['flex-shrink', '0'],
        ['flex-basis', 'auto'],
      ];
    if (value === 'auto' || value === 'initial')
      return [
        ['flex-grow', value === 'auto' ? '1' : '0'],
        ['flex-shrink', '1'],
        ['flex-basis', 'auto'],
      ];
    const numbers = words.filter((word) => /^\d*\.?\d+$/.test(word));
    return [
      ['flex-grow', numbers[0] || '1'],
      ['flex-shrink', numbers[1] || '1'],
      ['flex-basis', words.find((word) => !numbers.includes(word)) || '0%'],
    ];
  }
  if (property === 'border-radius') {
    const axes = postcss.list.split(value, ['/'], false);
    const expand = (axis: string) => {
      const parts = postcss.list.space(axis);
      return [parts[0], parts[1] || parts[0], parts[2] || parts[0], parts[3] || parts[1] || parts[0]];
    };
    const horizontal = expand(axes[0]);
    const vertical = expand(axes[1] || axes[0]);
    return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner, i) => [
      `border-${corner}-radius`,
      horizontal[i] === vertical[i] ? horizontal[i] : `${horizontal[i]} ${vertical[i]}`,
    ]);
  }
  if (/^border(?:-(?:top|right|bottom|left))?$/.test(property) && !/var\(/.test(value)) {
    const width =
      words.find((word) => /^(?:thin|medium|thick|0|[\d.]+(?:px|rem|em))$/.test(word)) || 'medium';
    const style =
      words.find((word) =>
        /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(word)
      ) || 'none';
    const color = words.filter((word) => word !== width && word !== style).join(' ') || 'currentColor';
    return (property === 'border' ? sides : [property.slice(7)]).flatMap(
      (side) =>
        [
          [`border-${side}-width`, width],
          [`border-${side}-style`, style],
          [`border-${side}-color`, color],
        ] as Array<[string, string]>
    );
  }
  return [[property, value]];
}

function strictUtility(property: string, value: string): string {
  const exact = EXACT_UTILITIES[property]?.[value.toLowerCase()];
  if (exact) return exact;
  const prefix = ARBITRARY_PREFIXES[property];
  const spacing = /^(?:margin|padding|gap|row-gap|column-gap|top|right|bottom|left)(?:-|$)/.test(property);
  if (prefix && spacing) {
    const numeric = value.match(/^(-?\d*\.?\d+)(px|rem)$/);
    if (value === '0' || value === '0px') return `${prefix}-0`;
    if (value === 'auto' && property.startsWith('margin')) return `${prefix}-auto`;
    if (numeric) {
      const units = Number(numeric[1]) * (numeric[2] === 'rem' ? 4 : 0.25);
      // Tailwind's default spacing scale, not every possible quarter-rem value.
      const scale = [
        0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48,
        52, 56, 60, 64, 72, 80, 96,
      ];
      if (scale.includes(Math.abs(units))) return `${units < 0 ? '-' : ''}${prefix}-${Math.abs(units)}`;
    }
  }
  if (
    prefix &&
    !['color', 'background-color', 'font-size', 'border-width', 'border-color'].includes(property)
  )
    return `${prefix}-[${strictValue(value)}]`;
  if (property === 'color') return `text-[color:${strictValue(value)}]`;
  if (property === 'background-color') return `bg-[color:${strictValue(value)}]`;
  if (property === 'font-size') return `text-[length:${strictValue(value)}]`;
  return `[${property}:${strictValue(value)}]`;
}

function conditionVariant(condition: StrictCondition): string {
  if (condition.native) return `${condition.native}:`;
  return condition.kind === 'selector'
    ? `[${strictValue(condition.value)}]:`
    : `[@${condition.kind}_${strictValue(condition.value)}]:`;
}

/** Resolve selectors against the source DOM, then emit only winning element-local utilities.
 * Conditional competitors are made mutually exclusive when native Tailwind order cannot
 * express the original cascade. No source specificity is transplanted into output CSS.
 */
function convertStrictTailwind(
  documents: readonly TailwindDocumentInput[],
  css: string
): TailwindConversionResult {
  // Resolve native nesting before matching selectors against the captured DOM.
  const root = postcss([postcssNesting()])
    .process(css || '', { from: undefined })
    .sync().root;
  const layerPaths = new WeakMap<AtRule, number[]>();
  const layerChildren = new Map<string, Map<string, number>>();
  let anonymousLayer = 0;
  const registerLayer = (name: string, prefix: number[]): number[] => {
    const result = [...prefix];
    for (const part of name.split('.')) {
      const key = result.join('.');
      const children = layerChildren.get(key) || new Map<string, number>();
      if (!children.has(part)) children.set(part, children.size);
      layerChildren.set(key, children);
      result.push(children.get(part)!);
    }
    return result;
  };
  root.walkAtRules('layer', (rule) => {
    let parent: postcss.Node | undefined = rule.parent;
    while (parent && !(parent.type === 'atrule' && (parent as AtRule).name === 'layer'))
      parent = parent.parent;
    const prefix = parent ? layerPaths.get(parent as AtRule) || [] : [];
    const names = postcss.list.comma(rule.params.replace(/\/\*[\s\S]*?\*\//g, '')).filter(Boolean);
    if (!names.length && rule.nodes) names.push(`__anonymous-${anonymousLayer++}`);
    for (const name of names) {
      const layer = registerLayer(name.trim(), prefix);
      if (rule.nodes) layerPaths.set(rule, layer);
    }
  });
  const warnings: TailwindConversionWarning[] = [];
  const utilities = new Set<string>();
  const stats = {
    declarationsSeen: 0,
    declarationsConverted: 0,
    declarationsPreserved: 0,
    inlineDeclarationsConverted: 0,
    sourceClassesRemoved: 0,
  };
  const loaded = documents.map((document) => ({
    document,
    $: cheerio.load(document.html),
    candidates: new Map<object, StrictCandidate[]>(),
  }));
  const converted = new Set<Declaration>();
  const inlineDeclarations = new Set<Declaration>();
  let order = 0;
  const warn = (message: string, selector?: string, property?: string) => {
    warnings.push({ message, selector, property });
  };
  const add = (
    documentIndex: number,
    element: object,
    declaration: Declaration,
    specificity: Specificity,
    conditions: StrictCondition[],
    pseudo: string,
    inline: boolean,
    sourceOrder: number,
    layer: number[] = []
  ) => {
    if (inline) inlineDeclarations.add(declaration);
    const property = declaration.prop.startsWith('--') ? declaration.prop : declaration.prop.toLowerCase();
    const value = declaration.value.trim();
    if (!/^(?:--[\w-]+|[-a-zA-Z][\w-]*)$/.test(property) || !value || /[{};]/.test(value)) {
      warn(
        `Unsupported Tailwind declaration ${property}: ${value}; omitted rather than retaining custom CSS.`,
        undefined,
        property
      );
      return;
    }
    // Invalid source declarations do not participate in the browser cascade.
    // Do not let malformed lengths (e.g. padding:0r) displace valid rules.
    if (/(?:^|[\s,(])-?\d*\.?\d+r(?:$|[\s,)])/i.test(value)) {
      warn(
        `Invalid CSS length in ${property}: ${value}; ignored like the source browser.`,
        undefined,
        property
      );
      return;
    }
    const list = loaded[documentIndex].candidates.get(element) || [];
    strictLonghands(property, value).forEach(([prop, val]) =>
      list.push({
        property: prop,
        value: val,
        declaration,
        inline,
        specificity,
        layer,
        conditions,
        pseudo,
        order: sourceOrder,
      })
    );
    loaded[documentIndex].candidates.set(element, list);
  };
  root.walkDecls(() => {
    stats.declarationsSeen++;
  });
  root.walkAtRules((rule) => {
    if (!['media', 'supports', 'container', 'layer'].includes(rule.name.toLowerCase()))
      warn(
        `Unsupported @${rule.name} ${rule.params}; original rule omitted. ${/font-face/i.test(rule.name) ? 'Custom web fonts require @font-face; the font stack uses an available fallback.' : /keyframes/i.test(rule.name) ? 'Custom keyframe animations require a Tailwind theme definition and are not reproduced.' : ''}`
      );
  });
  root.walkRules((rule) => {
    const conditions: StrictCondition[] = [];
    let layer: number[] = [];
    let parent = rule.parent;
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule' && parent.name.toLowerCase() === 'layer') {
        if (!layer.length) layer = layerPaths.get(parent) || [];
        parent = parent.parent;
        continue;
      }
      if (
        parent.type !== 'atrule' ||
        !['media', 'supports', 'container'].includes(parent.name.toLowerCase())
      ) {
        warn('Unsupported selector context (such as a keyframe); source rule omitted.', rule.selector);
        return;
      }
      conditions.unshift({
        kind: parent.name.toLowerCase() as StrictCondition['kind'],
        value: parent.params.trim(),
      });
      parent = parent.parent;
    }
    let selectors: selectorParser.Root;
    try {
      selectors = selectorParser().astSync(rule.selector);
    } catch {
      warn('Unsupported selector syntax; source CSS omitted.', rule.selector);
      return;
    }
    const declarations = rule.nodes
      .filter((node): node is Declaration => node.type === 'decl')
      .map((declaration) => ({ declaration, order: order++ }));
    for (const selector of selectors.nodes) {
      const specificity = selectorSpecificity(selector.nodes);
      const query = selector.clone();
      const localConditions = [...conditions];
      let pseudo = '';
      let unsupported = false;
      const lastCombinator = selector.nodes.reduce(
        (last, node, i) => (node.type === 'combinator' ? i : last),
        -1
      );
      // Strip live states for static matching, retaining them as focused conditions.
      query.walkPseudos((node) => {
        if (node.value.startsWith('::') || /^:(before|after|first-line|first-letter)$/.test(node.value)) {
          if (node.parent !== query) {
            unsupported = true;
            return;
          }
          pseudo = `::${node.value.replace(/^:+/, '')}`;
          node.remove();
        } else if (
          /^:(hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|visited|target|link)$/.test(
            node.value
          )
        ) {
          if (node.parent !== query) {
            unsupported = true;
            return;
          }
          const originalIndex = selector.nodes.findIndex(
            (original) => original.sourceIndex === node.sourceIndex
          );
          if (originalIndex > lastCombinator)
            localConditions.push({ kind: 'selector', value: `&${node.value}`, native: node.value.slice(1) });
          else {
            // Keep just the relationship needed for the live state, not a root rule dump.
            const prefix = selector.nodes
              .slice(0, lastCombinator + 1)
              .map((original) => original.toString())
              .join('');
            localConditions.push({ kind: 'selector', value: `${prefix}&` });
          }
          node.remove();
        }
      });
      if (unsupported) {
        warn(
          'Nested live-state selectors cannot be resolved synchronously; rule omitted.',
          selector.toString()
        );
        continue;
      }
      const queryText = query.toString().trim() || '*';
      loaded.forEach(({ $ }, documentIndex) => {
        try {
          $(queryText).each((_, element) => {
            declarations.forEach((item) =>
              add(
                documentIndex,
                element,
                item.declaration,
                specificity,
                localConditions,
                pseudo,
                false,
                item.order,
                layer
              )
            );
          });
        } catch {
          warn('Selector is not supported by the static DOM matcher; rule omitted.', selector.toString());
        }
      });
    }
  });
  loaded.forEach(({ $, candidates }, documentIndex) => {
    $('[style]').each((_, element) => {
      try {
        postcss.parse(`x{${$(element).attr('style') || ''}}`).walkDecls((declaration) => {
          add(documentIndex, element, declaration, [0, 0, 0], [], '', true, order++);
        });
      } catch {
        warn('Malformed inline CSS omitted rather than retained.');
      }
      $(element).removeAttr('style');
    });
    for (const [element, list] of candidates) {
      const pending: Array<{ variant: string; property: string; value: string }> = [];
      const opaqueShorthands: Record<string, string> = {
        font: 'font-',
        animation: 'animation-',
        transition: 'transition-',
        grid: 'grid-',
        'list-style': 'list-style-',
        background: 'background-',
        border: 'border-',
      };
      for (const candidate of list) {
        const prefix = opaqueShorthands[candidate.property];
        if (prefix && list.some((other) => other.property.startsWith(prefix)))
          warn(
            `Shorthand ${candidate.property} cannot be fully expanded synchronously; overlapping longhands may differ from the source cascade.`,
            undefined,
            candidate.property
          );
        if (/^(?:margin|padding|inset|border)-(?:inline|block)/.test(candidate.property))
          warn(
            'Logical and physical properties depend on writing mode; overlapping declarations may differ from the source cascade.',
            undefined,
            candidate.property
          );
      }
      const groups = new Map<string, StrictCandidate[]>();
      list.forEach((candidate) => {
        const key = `${candidate.pseudo}|${candidate.property}`;
        const group = groups.get(key) || [];
        group.push(candidate);
        groups.set(key, group);
      });
      for (const group of groups.values()) {
        group.sort((a, b) => compareStrict(b, a));
        const higher: StrictCandidate[] = [];
        for (const candidate of group) {
          const key = (condition: StrictCondition) => `${condition.kind}:${condition.value}`;
          const current = new Set(candidate.conditions.map(key));
          if (higher.some((other) => other.conditions.every((condition) => current.has(key(condition)))))
            continue;
          let variant = candidate.conditions.map(conditionVariant).join('');
          let unsupported = false;
          for (const other of higher) {
            const extra = other.conditions.filter((condition) => !current.has(key(condition)));
            // Base classes naturally precede conditional utilities. All other overlapping
            // contexts need explicit exclusions, since class order is not CSS source order.
            if (
              !candidate.conditions.length &&
              !candidate.declaration.important &&
              !other.declaration.important
            )
              continue;
            if (extra.length !== 1) {
              unsupported = true;
              break;
            }
            const condition = extra[0];
            if (condition.kind === 'selector' && condition.value.startsWith('&:'))
              variant += `[&:not(${strictValue(condition.value.slice(1))})]:`;
            else if (condition.kind === 'media' && !condition.value.includes(',')) {
              // CSS media 'not' negates the entire query, including compound
              // width/height tests. Preserve an explicit media type (screen).
              const query = condition.value.replace(/^only\s+/i, '').trim();
              const inverse = /^not\s+/i.test(query)
                ? query.replace(/^not\s+/i, '')
                : /^(?:screen|print|all)\b/i.test(query)
                  ? `not ${query}`
                  : `not all and ${query}`;
              variant += `[@media_${strictValue(inverse)}]:`;
            } else if (condition.kind === 'supports')
              variant += `[@supports_not_${strictValue(condition.value)}]:`;
            else {
              unsupported = true;
              break;
            }
          }
          if (unsupported) {
            warn(
              'Overlapping compound conditions cannot be represented without selector/cascade hacks; lower-priority declaration omitted.',
              undefined,
              candidate.property
            );
            continue;
          }
          if (candidate.pseudo)
            variant += `${['::before', '::after', '::first-line', '::first-letter', '::placeholder', '::selection', '::marker'].includes(candidate.pseudo) ? candidate.pseudo.slice(2) : `[&${candidate.pseudo}]`}:`;
          pending.push({
            variant: `${variant}${candidate.declaration.important ? '!' : ''}`,
            property: candidate.property,
            value: candidate.value,
          });
          converted.add(candidate.declaration);
          higher.push(candidate);
        }
      }
      // Recombine equal winning sides into readable p-5 / px-2 / gap-1 classes.
      for (const variant of new Set(pending.map((item) => item.variant))) {
        for (const base of ['padding', 'margin', 'gap']) {
          const properties =
            base === 'gap'
              ? ['row-gap', 'column-gap']
              : ['top', 'right', 'bottom', 'left'].map((side) => `${base}-${side}`);
          const sides = properties.map((property) =>
            pending.find((item) => item.variant === variant && item.property === property)
          );
          const merge = (indices: number[], property: string) => {
            const entries = indices.map((i) => sides[i]);
            if (
              entries.some((entry) => !entry) ||
              !entries.every((entry) => entry!.value === entries[0]!.value)
            )
              return false;
            entries.forEach((entry) => {
              pending.splice(pending.indexOf(entry!), 1);
            });
            pending.push({ variant, property, value: entries[0]!.value });
            return true;
          };
          if (
            merge(
              properties.map((_, i) => i),
              base
            ) ||
            base === 'gap'
          )
            continue;
          // Axis utilities are generated directly, as they are not CSS properties.
          for (const [indices, prefix] of [
            [[0, 2], base === 'padding' ? 'py' : 'my'],
            [[1, 3], base === 'padding' ? 'px' : 'mx'],
          ] as Array<[number[], string]>) {
            const entries = indices.map((i) => sides[i]);
            if (entries.some((entry) => !entry) || entries[0]!.value !== entries[1]!.value) continue;
            entries.forEach((entry) => {
              pending.splice(pending.indexOf(entry!), 1);
            });
            const utility = strictUtility(base, entries[0]!.value).replace(/^(\-?)[mp]-/, `$1${prefix}-`);
            const className = `${variant}${utility}`;
            appendClass($, element, className);
            utilities.add(className);
          }
        }
      }
      pending.forEach((item) => {
        const className = `${item.variant}${strictUtility(item.property, item.value)}`;
        appendClass($, element, className);
        utilities.add(className);
      });
    }
    $('style, link[rel~="stylesheet"], link[as="style"]').remove();
  });
  converted.forEach((declaration) => {
    if (inlineDeclarations.has(declaration)) stats.inlineDeclarationsConverted++;
    else stats.declarationsConverted++;
  });
  // Source classes remain as DOM/script hooks, but cannot generate accidental framework
  // utilities: callers compile the returned exact utility list rather than scanning HTML.
  return {
    documents: loaded.map(({ document, $ }) => ({ id: document.id, html: $.html() })),
    residualCss: '',
    utilities: [...utilities],
    warnings,
    stats,
  };
}

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, '_').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function utilityFor(property: string, rawValue: string, important: boolean): string | null {
  const value = rawValue.trim();
  if (!value || value.includes(';') || /[{}]/.test(value)) return null;
  // Asset URLs belong in residual CSS: serializing quoted URLs into HTML class
  // attributes entity-encodes their quotes and confuses Tailwind's source scanner.
  if (/url\s*\(/i.test(value)) return null;

  const exact = EXACT_UTILITIES[property]?.[value.toLowerCase()];
  let utility = exact || null;

  if (!utility) {
    const prefix = ARBITRARY_PREFIXES[property];
    if (prefix) utility = `${prefix}-[${normalizeValue(value)}]`;
  }

  if (
    !utility &&
    property === 'border-style' &&
    ['solid', 'dashed', 'dotted', 'double', 'none'].includes(value)
  ) {
    utility = value === 'none' ? 'border-none' : `border-${value}`;
  }

  if (!utility && property === 'cursor') utility = `cursor-[${normalizeValue(value)}]`;
  if (!utility && property === 'aspect-ratio') utility = `aspect-[${normalizeValue(value)}]`;

  return utility ? `${important ? '!' : ''}${utility}` : null;
}

function parseSelector(selector: string): SelectorInfo[] | null {
  const parts = selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed: SelectorInfo[] = [];

  for (const part of parts) {
    const match = part.match(
      /^(\.[A-Za-z_-][\w-]*)(?::(hover|focus|focus-visible|active|disabled|checked))?$/
    );
    if (!match) return null;
    parsed.push({ query: match[1], variant: match[2] ? STATIC_VARIANTS[match[2]] : '' });
  }

  return parsed.length > 0 ? parsed : null;
}

function mediaVariant(rule: Rule): string | null {
  let parent = rule.parent;
  let variant = '';
  while (parent && parent.type !== 'root') {
    if (parent.type !== 'atrule') return null;
    const atRule = parent as AtRule;
    if (atRule.name !== 'media') return null;
    const match = atRule.params.trim().match(/^\(min-width:\s*([^)]+)\)$/i);
    if (!match) return null;
    variant += `min-[${normalizeValue(match[1])}]:`;
    parent = parent.parent;
  }
  return variant;
}

function appendClass($: LoadedDocument, element: unknown, className: string): void {
  const current =
    $(element as never)
      .attr('class')
      ?.split(/\s+/)
      .filter(Boolean) || [];
  if (!current.includes(className)) current.push(className);
  $(element as never).attr('class', current.join(' '));
}

function referencedClasses(root: postcss.Root): Set<string> {
  const classes = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) classes.add(match[1]);
  };
  root.walkRules((rule) => collect(rule.selector));
  root.walkAtRules((rule) => collect(rule.params));
  return classes;
}

const INTERACTION_CLASS =
  /^(?:js-|is-|has-|state-|active$|open$|selected$|disabled$|expanded$|collapsed$|current$|menu|nav|modal|dialog|dropdown|accordion|carousel|slider|tab(?:s)?$)/i;

function pruneEmptyContainers(root: postcss.Root): void {
  let changed = true;
  while (changed) {
    changed = false;
    root.walk((node) => {
      if ((node.type === 'rule' || node.type === 'atrule') && node.nodes && node.nodes.length === 0) {
        node.remove();
        changed = true;
      }
    });
  }
}

/**
 * Conservatively migrates CSS to Tailwind utilities. Only simple class selectors are
 * removed from CSS, and declarations that conflict on the same element/state remain
 * in residual CSS. A source class is removed only when its CSS was fully converted;
 * residual selectors, at-rule parameters, and likely interaction hooks retain it.
 */
export function convertDocumentsToTailwind(
  documents: readonly TailwindDocumentInput[],
  css: string,
  options: { strict?: boolean } = {}
): TailwindConversionResult {
  if (options.strict) return convertStrictTailwind(documents, css);
  const loaded = documents.map((document) => ({ document, $: cheerio.load(document.html) }));
  const warnings: TailwindConversionWarning[] = [];
  const stats = {
    declarationsSeen: 0,
    declarationsConverted: 0,
    declarationsPreserved: 0,
    inlineDeclarationsConverted: 0,
    sourceClassesRemoved: 0,
  };
  let root: postcss.Root;

  try {
    root = postcss.parse(css || '');
  } catch (error) {
    return {
      documents: documents.map((document) => ({ ...document })),
      residualCss: css,
      warnings: [
        {
          message: `CSS parser could not migrate this stylesheet; it was preserved: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      stats,
    };
  }

  const sourceCssClasses = referencedClasses(root);
  const originalElementClasses = loaded.map(({ $ }) => {
    const classes = new WeakMap<object, string[]>();
    $('[class]').each((_, element) => {
      classes.set(element as object, ($(element).attr('class') || '').split(/\s+/).filter(Boolean));
    });
    return classes;
  });
  const generatedClasses = loaded.map(() => new WeakMap<object, Set<string>>());
  const addUtility = (documentIndex: number, element: unknown, className: string) => {
    const node = element as object;
    const classes = generatedClasses[documentIndex].get(node) || new Set<string>();
    classes.add(className);
    generatedClasses[documentIndex].set(node, classes);
    appendClass(loaded[documentIndex].$, element, className);
  };
  const candidates: Candidate[] = [];
  const elementIds = loaded.map(() => ({ ids: new WeakMap<object, number>(), next: 0 }));
  root.walkDecls(() => {
    stats.declarationsSeen++;
  });

  root.walkRules((rule) => {
    const selectors = parseSelector(rule.selector);
    const responsive = mediaVariant(rule);
    if (!selectors || responsive === null) return;

    rule.nodes?.forEach((node) => {
      if (node.type !== 'decl') return;
      const declaration = node as Declaration;
      const utility = utilityFor(declaration.prop.toLowerCase(), declaration.value, declaration.important);
      if (!utility) return;

      selectors.forEach((selector) => {
        const targets: Candidate['targets'] = [];
        loaded.forEach(({ $ }, documentIndex) => {
          try {
            $(selector.query).each((_, element) => {
              const elementObject = element as object;
              let elementId = elementIds[documentIndex].ids.get(elementObject);
              if (elementId === undefined) {
                elementId = elementIds[documentIndex].next++;
                elementIds[documentIndex].ids.set(elementObject, elementId);
              }
              targets.push({
                documentIndex,
                element,
                key: `${documentIndex}:${elementId}:${responsive}${selector.variant}`,
              });
            });
          } catch {
            // Cheerio selector rejection means the source rule must be preserved.
          }
        });

        if (targets.length > 0) {
          candidates.push({
            declaration,
            property: declaration.prop.toLowerCase(),
            className: `${responsive}${selector.variant}${utility}`,
            targets,
          });
        }
      });
    });
  });

  const conflicts = new Set<Declaration>();
  const seen = new Map<string, Declaration>();
  for (const candidate of candidates) {
    for (const target of candidate.targets) {
      const key = `${target.key}:${candidate.property}`;
      const previous = seen.get(key);
      if (previous && previous !== candidate.declaration) {
        conflicts.add(previous);
        conflicts.add(candidate.declaration);
      } else {
        seen.set(key, candidate.declaration);
      }
    }
  }

  // Layout shorthand/longhand and complex selectors participate in the same
  // cascade even when they are not migration candidates. Preserve overlapping
  // geometry rules instead of letting utility ordering shift centered containers.
  const layoutFamily = (property: string): string | null => {
    if (/^margin(?:-|$)/.test(property)) return 'margin';
    if (/^padding(?:-|$)/.test(property)) return 'padding';
    if (/^(?:width|min-width|max-width|inline-size|min-inline-size|max-inline-size)$/.test(property))
      return 'width';
    if (/^(?:inset(?:-.*)?|top|right|bottom|left)$/.test(property)) return 'inset';
    if (
      /^(?:text-align|display|position|box-sizing|justify-content|align-items|align-self|place-items|place-content)$/.test(
        property
      )
    )
      return property;
    return null;
  };
  const layoutDeclarations = loaded.map(() => new WeakMap<object, Map<string, Set<Declaration>>>());
  root.walkRules((rule) => {
    // Keyframes are animation frames, not competing element layout rules.
    for (let parent: postcss.Node | undefined = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test((parent as AtRule).name)) return;
    }
    const declarations = (rule.nodes || []).filter((node) => node.type === 'decl') as Declaration[];
    loaded.forEach(({ $ }, documentIndex) => {
      try {
        $(rule.selector).each((_, element) => {
          const families =
            layoutDeclarations[documentIndex].get(element) || new Map<string, Set<Declaration>>();
          for (const declaration of declarations) {
            const family = layoutFamily(declaration.prop.toLowerCase());
            if (!family) continue;
            const entries = families.get(family) || new Set<Declaration>();
            entries.add(declaration);
            families.set(family, entries);
          }
          layoutDeclarations[documentIndex].set(element, families);
        });
      } catch {
        /* Dynamic/pseudo-element selectors remain in source CSS. */
      }
    });
  });
  for (const candidate of candidates) {
    const family = layoutFamily(candidate.property);
    if (
      family &&
      candidate.targets.some(
        (target) =>
          (layoutDeclarations[target.documentIndex].get(target.element as object)?.get(family)?.size || 0) > 1
      )
    )
      conflicts.add(candidate.declaration);
    if (conflicts.has(candidate.declaration)) {
      warnings.push({
        selector: (candidate.declaration.parent as Rule).selector,
        property: candidate.property,
        message: 'Preserved because multiple rules can set this property on the same element/state.',
      });
      continue;
    }
    for (const target of candidate.targets) {
      addUtility(target.documentIndex, target.element, candidate.className);
    }
    candidate.declaration.remove();
    stats.declarationsConverted++;
  }

  // Inline declarations have the highest author-level specificity. Important utilities
  // retain that intent while unsupported declarations remain inline.
  loaded.forEach(({ $ }, documentIndex) => {
    $('[style]').each((_, element) => {
      // Captured paint is a snapshot override, not a utility candidate. Moving
      // it to a class can tie with an !important source rule and hide text again.
      if ($(element).attr('data-captured-animation-state') !== undefined) return;
      const source = $(element).attr('style') || '';
      let parsed: postcss.Root;
      try {
        parsed = postcss.parse(`a{${source}}`);
      } catch {
        return;
      }
      const rule = parsed.first as Rule | undefined;
      if (!rule) return;
      const residual: string[] = [];
      rule.walkDecls((declaration) => {
        // Inline geometry must keep its original specificity over resets and
        // source rules, including shorthand/longhand relationships.
        if (
          layoutFamily(declaration.prop.toLowerCase()) &&
          !/^padding(?:-|$)/.test(declaration.prop.toLowerCase())
        ) {
          residual.push(declaration.toString());
          return;
        }
        const utility = utilityFor(declaration.prop.toLowerCase(), declaration.value, true);
        if (utility) {
          addUtility(documentIndex, element, utility);
          stats.inlineDeclarationsConverted++;
        } else {
          residual.push(declaration.toString());
        }
      });
      if (residual.length > 0) $(element).attr('style', `${residual.join('; ')};`);
      else $(element).removeAttr('style');
    });
  });

  pruneEmptyContainers(root);

  const residualClasses = referencedClasses(root);
  loaded.forEach(({ $ }, documentIndex) => {
    $('[class]').each((_, element) => {
      const original = originalElementClasses[documentIndex].get(element as object) || [];
      if (original.length === 0) return;
      const hasDataHook = Object.keys((element as { attribs?: Record<string, string> }).attribs || {}).some(
        (name) => name.startsWith('data-')
      );
      const removable = new Set(
        original.filter(
          (className) =>
            sourceCssClasses.has(className) &&
            !residualClasses.has(className) &&
            !generatedClasses[documentIndex].get(element as object)?.has(className) &&
            !INTERACTION_CLASS.test(className) &&
            !hasDataHook
        )
      );
      if (removable.size === 0) return;
      const remaining = ($(element).attr('class') || '')
        .split(/\s+/)
        .filter((name) => name && !removable.has(name));
      stats.sourceClassesRemoved += removable.size;
      if (remaining.length > 0) $(element).attr('class', remaining.join(' '));
      else $(element).removeAttr('class');
    });
  });

  stats.declarationsPreserved = Math.max(0, stats.declarationsSeen - stats.declarationsConverted);

  return {
    documents: loaded.map(({ document, $ }) => ({ id: document.id, html: $.html() })),
    residualCss: root.toString(),
    warnings,
    stats,
  };
}
