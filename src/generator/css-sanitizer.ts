import postcss, { type ChildNode, type Container } from 'postcss';

export type CssSanitizationStrategy = 'original' | 'tailwind';

export interface SanitizeGeneratedCssOptions {
  strategy?: CssSanitizationStrategy;
}

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

export const UNCOMPILED_SOURCE_DIRECTIVES = new Set([
  'tailwind', 'apply', 'theme', 'utility', 'config', 'plugin', 'reference', 'custom-variant',
]);

function sourceCssError(reason: string, line?: number, column?: number): Error {
  const location = line && column ? ` at ${line}:${column}` : '';
  return new Error(`Cannot sanitize source CSS${location}: ${reason}. Compile the source stylesheet with its original CSS/Tailwind toolchain before importing it.`);
}

/** Detect directives before recovery can discard the malformed region containing them. */
function rejectSourceDirectives(css: string): void {
  let quote: string | undefined;
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (comment) {
      if (character === '*' && css[index + 1] === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') { comment = true; index += 1; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '\\') { index += 1; continue; }
    if (character !== '@') continue;
    const name = css.slice(index + 1).match(/^[-\w]+/u)?.[0]?.toLowerCase();
    if (!name || !UNCOMPILED_SOURCE_DIRECTIVES.has(name)) continue;
    const prefix = css.slice(0, index);
    const line = prefix.split('\n').length;
    const column = index - prefix.lastIndexOf('\n');
    throw sourceCssError(`unsupported uncompiled @${name} directive`, line, column);
  }
}


type CssRange = { start: number; end: number };

function templateTokenEnd(css: string, index: number): number | undefined {
  const endings: Array<[string, string]> = [
    ['{{{', '}}}'],
    ['{{', '}}'],
    ['<%', '%>'],
    ['${', '}'],
  ];
  for (const [opening, closing] of endings) {
    if (!css.startsWith(opening, index)) continue;
    const end = css.indexOf(closing, index + opening.length);
    if (end !== -1) return end + closing.length;
  }
  return undefined;
}

function applyRanges(css: string, ranges: CssRange[]): string {
  if (ranges.length === 0) return css;
  const merged = [...ranges]
    .sort((left, right) => left.start - right.start)
    .reduce<CssRange[]>((result, range) => {
      const previous = result[result.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else result.push({ ...range });
      return result;
    }, []);
  let output = '';
  let cursor = 0;
  for (const range of merged) {
    output += css.slice(cursor, range.start);
    cursor = range.end;
  }
  return output + css.slice(cursor);
}

/** Removes only declarations whose unquoted value contains a complete template placeholder. */
function removeTemplateDeclarations(css: string): string {
  const ranges: CssRange[] = [];
  const starts: number[] = [];
  const valueStarted: boolean[] = [];
  const invalid: boolean[] = [];
  let depth = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: '"' | "'" | undefined;
  let comment = false;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (comment) {
      if (character === '*' && css[index + 1] === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') { comment = true; index += 1; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }

    const tokenEnd = depth > 0 && valueStarted[depth] ? templateTokenEnd(css, index) : undefined;
    if (tokenEnd !== undefined) {
      invalid[depth] = true;
      index = tokenEnd - 1;
      continue;
    }
    if (character === '(') { parentheses += 1; continue; }
    if (character === ')') { parentheses = Math.max(0, parentheses - 1); continue; }
    if (character === '[') { brackets += 1; continue; }
    if (character === ']') { brackets = Math.max(0, brackets - 1); continue; }
    if (parentheses > 0 || brackets > 0) continue;

    if (character === '{') {
      depth += 1;
      starts[depth] = index + 1;
      valueStarted[depth] = false;
      invalid[depth] = false;
    } else if (character === ':' && depth > 0 && !valueStarted[depth]) {
      const property = css.slice(starts[depth], index).trim();
      if (/^(?:--|-[a-zA-Z]|[a-zA-Z_])[-_a-zA-Z0-9]*$/u.test(property)) valueStarted[depth] = true;
    } else if (character === ';' && depth > 0) {
      if (invalid[depth]) ranges.push({ start: starts[depth], end: index + 1 });
      starts[depth] = index + 1;
      valueStarted[depth] = false;
      invalid[depth] = false;
    } else if (character === '}' && depth > 0) {
      if (invalid[depth]) ranges.push({ start: starts[depth], end: index });
      depth -= 1;
      if (depth > 0) {
        starts[depth] = index + 1;
        valueStarted[depth] = false;
        invalid[depth] = false;
      }
    }
  }
  return applyRanges(css, ranges);
}

function findUnquotedTemplate(css: string): number | undefined {
  let quote: '"' | "'" | undefined;
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (comment) {
      if (character === '*' && css[index + 1] === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') { comment = true; index += 1; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (templateTokenEnd(css, index) !== undefined) return index;
  }
  return undefined;
}

/** Drops a selector/at-rule containing a remaining unquoted template token. */
function removeTemplateRules(css: string): string {
  let result = css;
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const token = findUnquotedTemplate(result);
    if (token === undefined) return result;
    let start = 0;
    let depth = 0;
    let tokenDepth = 0;
    let next = -1;
    let nextKind = '';
    let quote: '"' | "'" | undefined;
    let comment = false;
    for (let index = 0; index < result.length; index += 1) {
      const character = result[index];
      if (comment) { if (character === '*' && result[index + 1] === '/') { comment = false; index += 1; } continue; }
      if (quote) { if (character === '\\') index += 1; else if (character === quote) quote = undefined; continue; }
      if (character === '/' && result[index + 1] === '*') { comment = true; index += 1; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      const end = templateTokenEnd(result, index);
      if (end !== undefined) { if (index === token) tokenDepth = depth; index = end - 1; continue; }
      if (index < token) {
        if (character === '{') { depth += 1; start = index + 1; }
        else if (character === '}') { depth = Math.max(0, depth - 1); start = index + 1; }
        else if (character === ';') start = index + 1;
      } else if (depth === tokenDepth && (character === '{' || character === ';' || character === '}')) {
        next = index; nextKind = character; break;
      }
    }
    if (next === -1) throw sourceCssError('unrecoverable template rule without a closing delimiter');
    if (nextKind !== '{') { result = result.slice(0, start) + result.slice(next + (nextKind === ';' ? 1 : 0)); continue; }
    let blockDepth = 1;
    let end = next + 1;
    quote = undefined; comment = false;
    for (; end < result.length && blockDepth > 0; end += 1) {
      const character = result[end];
      if (comment) { if (character === '*' && result[end + 1] === '/') { comment = false; end += 1; } continue; }
      if (quote) { if (character === '\\') end += 1; else if (character === quote) quote = undefined; continue; }
      if (character === '/' && result[end + 1] === '*') { comment = true; end += 1; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '{') blockDepth += 1;
      else if (character === '}') blockDepth -= 1;
    }
    if (blockDepth !== 0) throw sourceCssError('unclosed template rule block');
    result = result.slice(0, start) + result.slice(end);
  }
  if (findUnquotedTemplate(result) !== undefined) throw sourceCssError('template rule cleanup exceeded its recovery limit');
  return result;
}

function precleanGeneratedCss(css: string): string {
  return removeTemplateRules(removeTemplateDeclarations(css));
}

function offsetFromLineColumn(css: string, line: number, column: number): number {
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = css.indexOf('\n', offset);
    if (newline === -1) return css.length;
    offset = newline + 1;
  }
  return Math.min(css.length, offset + Math.max(0, column - 1));
}

/** Best-effort recovery: remove the smallest enclosing malformed rule and retry parsing. */
function recoverMalformedCss(css: string): postcss.Root | undefined {
  let candidate = css;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { return postcss.parse(candidate); } catch (error) {
      const syntaxError = error as { line?: number; column?: number; reason?: string };
      // Only a complete malformed rule can be safely dropped. Unclosed strings,
      // comments and blocks do not provide trustworthy recovery boundaries.
      if (!syntaxError.reason?.startsWith('Unknown word') || !syntaxError.line || !syntaxError.column) return undefined;
      const offset = offsetFromLineColumn(candidate, syntaxError.line, syntaxError.column);
      const stack: number[] = [];
      let quote: '"' | "'" | undefined;
      let comment = false;
      for (let index = 0; index < offset; index += 1) {
        const character = candidate[index];
        if (comment) { if (character === '*' && candidate[index + 1] === '/') { comment = false; index += 1; } continue; }
        if (quote) { if (character === '\\') index += 1; else if (character === quote) quote = undefined; continue; }
        if (character === '/' && candidate[index + 1] === '*') { comment = true; index += 1; continue; }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (character === '{') stack.push(index);
        else if (character === '}') stack.pop();
      }
      const opening = stack.pop();
      if (opening === undefined) return undefined;
      let start = opening;
      while (start > 0 && !';{}'.includes(candidate[start - 1])) start -= 1;
      let end: number | undefined;
      let depth = 1;
      quote = undefined;
      comment = false;
      for (let index = opening + 1; index < candidate.length; index += 1) {
        const character = candidate[index];
        if (comment) { if (character === '*' && candidate[index + 1] === '/') { comment = false; index += 1; } continue; }
        if (quote) { if (character === '\\') index += 1; else if (character === quote) quote = undefined; continue; }
        if (character === '/' && candidate[index + 1] === '*') { comment = true; index += 1; continue; }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (character === '\\') { index += 1; continue; }
        if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) { end = index + 1; break; }
      }
      if (end === undefined || start === end) return undefined;
      candidate = candidate.slice(0, start) + candidate.slice(end);
    }
  }
  return undefined;
}

function splitSelectorList(selector: string): string[] {
  const branches: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2);
      index = end === -1 ? selector.length : end + 1;
      continue;
    }
    if (character === '[') brackets += 1;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (brackets === 0 && character === '(') parentheses += 1;
    else if (brackets === 0 && character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === ',' && brackets === 0 && parentheses === 0) {
      branches.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  branches.push(selector.slice(start));
  return branches;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\w-]/u.test(character);
}

function hasSelectorAfter(selector: string, start: number, parentheses: number): boolean {
  let index = start;
  while (index < selector.length) {
    if (/\s/u.test(selector[index])) {
      index += 1;
      continue;
    }
    if (selector[index] === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2);
      if (end === -1) return false;
      index = end + 2;
      continue;
    }
    const character = selector[index];
    if (character === ',' || (character === ')' && parentheses > 0)) return false;
    if (character === '>' || character === '+' || character === '~') {
      index += 1;
      continue;
    }
    return true;
  }
  return false;
}

function hasInvalidPseudoElementCombinator(selector: string): boolean {
  let parentheses = 0;
  let brackets = 0;
  let quote: '"' | "'" | undefined;
  const pseudoElementContexts = new Set<number>();

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2);
      index = end === -1 ? selector.length : end + 1;
      continue;
    }
    if (character === '[') {
      brackets += 1;
      continue;
    }
    if (character === ']') {
      brackets = Math.max(0, brackets - 1);
      continue;
    }
    if (brackets > 0) continue;
    if (character === '(') {
      parentheses += 1;
      continue;
    }
    if (character === ')') {
      pseudoElementContexts.delete(parentheses);
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === ',') {
      pseudoElementContexts.delete(parentheses);
      continue;
    }
    if (character === ':') {
      const doubleColon = selector[index + 1] === ':';
      const nameStart = index + (doubleColon ? 2 : 1);
      let nameEnd = nameStart;
      while (isIdentifierCharacter(selector[nameEnd])) nameEnd += 1;
      const name = selector.slice(nameStart, nameEnd).toLowerCase();
      if ((doubleColon && name.length > 0) || LEGACY_PSEUDO_ELEMENTS.has(name))
        pseudoElementContexts.add(parentheses);
      index = Math.max(index, nameEnd - 1);
      continue;
    }
    if (!pseudoElementContexts.has(parentheses)) continue;
    if (character === '>' || character === '+' || character === '~') {
      if (hasSelectorAfter(selector, index + 1, parentheses)) return true;
    } else if (/\s/u.test(character)) {
      let end = index + 1;
      while (end < selector.length && /\s/u.test(selector[end])) end += 1;
      if (
        selector[end] !== '>' &&
        selector[end] !== '+' &&
        selector[end] !== '~' &&
        hasSelectorAfter(selector, end, parentheses)
      )
        return true;
    }
  }
  return false;
}

function removeInvalidSelectorBranches(root: postcss.Root): void {
  root.walkRules((rule) => {
    const validBranches = splitSelectorList(rule.selector).filter(
      (branch) => branch.trim() && !hasInvalidPseudoElementCombinator(branch)
    );
    if (validBranches.length === 0) rule.remove();
    else rule.selector = validBranches.join(',').trim();
  });
}

function hasMeaningfulChildren(node: Container<ChildNode>): boolean {
  return node.nodes?.some((child) => child.type !== 'comment') ?? false;
}

/** Removes structurally invalid or empty CSS before generated CSS is emitted. */
export function sanitizeGeneratedCss(css: string, options: SanitizeGeneratedCssOptions = {}): string {
  rejectSourceDirectives(css || '');
  const cleaned = precleanGeneratedCss(css || '');
  let root: postcss.Root;
  try {
    root = postcss.parse(cleaned);
  } catch (error) {
    const recovered = recoverMalformedCss(cleaned);
    if (!recovered) {
      const syntaxError = error as { reason?: string; line?: number; column?: number };
      throw sourceCssError(syntaxError.reason ?? 'unrecoverable malformed CSS', syntaxError.line, syntaxError.column);
    }
    root = recovered;
  }

  removeInvalidSelectorBranches(root);

  // A concatenated source bundle can have several charset declarations. Retain
  // only the first, at the beginning where CSS permits it; nested ones are invalid.
  let charset: postcss.AtRule | undefined;
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    if (UNCOMPILED_SOURCE_DIRECTIVES.has(name)) {
      throw sourceCssError(`unsupported uncompiled @${name} directive`, atRule.source?.start?.line, atRule.source?.start?.column);
    }
    if (name === 'charset') {
      if (atRule.parent !== root || atRule.nodes) {
        throw sourceCssError('invalid nested or block @charset directive', atRule.source?.start?.line, atRule.source?.start?.column);
      }
      if (charset) atRule.remove();
      else charset = atRule;
    }
    if (name === 'layer' && options.strategy === 'tailwind') {
      // Rename identifiers, not substrings: lists, qualified names and nested
      // layer blocks must all refer to the same native cascade layers. Comments
      // are kept intact and CSS identifier escapes are decoded for matching.
      const layerParams = atRule.raws.params?.value === atRule.params ? atRule.raws.params.raw : atRule.params;
      atRule.params = layerParams.replace(/\/\*[\s\S]*?\*\/|(?:\\[0-9a-fA-F]{1,6}\s?|\\[^\r\n\f]|[-\w\u0080-\uFFFF])+/gu, (identifier) => {
        if (identifier.startsWith('/*')) return identifier;
        const decoded = identifier.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^\r\n\f])/gu, (_match, hex: string | undefined, escaped: string | undefined) =>
          hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : escaped ?? '');
        return ['base', 'components', 'utilities'].includes(decoded) ? `source-${decoded}` : identifier;
      });
    }
  });
  if (charset) { charset.remove(); root.prepend(charset); }

  let changed = true;
  while (changed) {
    changed = false;
    root.walk((node) => {
      if (node.type === 'rule' && (!node.selector.trim() || !hasMeaningfulChildren(node))) {
        node.remove();
        changed = true;
        return;
      }
      if (node.type === 'atrule' && node.name.toLowerCase() !== 'layer' && node.nodes && !hasMeaningfulChildren(node)) {
        node.remove();
        changed = true;
      }
    });
  }

  return root.toString();
}

/** Re-targets body-qualified source selectors to the generated page wrapper. */
export function rewriteBodyContextSelectors(css: string): string {
  let root: postcss.Root;
  try { root = postcss.parse(css || ''); } catch { return css; }

  root.walkRules((rule) => {
    rule.selector = splitSelectorList(rule.selector).map((branch) => {
      // Functional selectors can contain their own selector lists; leave them untouched
      // rather than risking a partial or semantically different rewrite.
      if (branch.includes('(')) return branch;
      return branch.replace(/^(\s*)body((?:[#.][-_a-zA-Z0-9]+)+)(?=\s|[>+~:[.]|$)/u, '$1$2');
    }).join(',');
  });
  return root.toString();
}
