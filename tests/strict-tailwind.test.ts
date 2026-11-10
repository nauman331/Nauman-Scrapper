import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { convertDocumentsToTailwind } from '../src/generator/analyzer/tailwind-converter.js';

const css = `@media(min-width:1px){.card{padding:99px}} :root{--space:12px}body{margin:0}.card{display:flex;padding:var(--space);width:300px;color:red;background:linear-gradient(red,blue);border:2px solid black;box-shadow:0 2px 8px #0005;transform:translateX(2px);transition:color .1s}
.card{color:green;padding:20px;padding-left:7px}#hero{color:purple}.card:hover{background:yellow} .card:hover span{color:blue}.card::before{content:'hello_world';display:block}
@media(max-width:600px){.card{width:200px;display:grid;grid-template-columns:1fr 1fr;padding:8px}}`;
const html = '<div id="hero" class="card container" style="color:orange;width:240px;gap:4px"><span>Text</span></div>';
const compile = async (utilities: string[]) => (await postcss([tailwindcss({ content: [], safelist: utilities, corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined })).css;

describe('strict Tailwind conversion', () => {
  const documents = [{ id: 'budget', html: '<div class="card"></div>' }];
  const expectBudget = (run: () => unknown, name: string) => {
    expect(run).toThrow(Error);
    expect(run).toThrow(new RegExp(`${name} budget.*Core CSS.*fewer pages`));
  };

  it('rejects aggregate UTF-8 input before parsing, in both modes', () => {
    for (const strict of [true, false]) {
      expectBudget(() => convertDocumentsToTailwind([
        { id: 'a', html: 'éé' }, { id: 'b', html: 'éé' },
      ], '', { strict, limits: { htmlBytes: 7 } }), 'htmlBytes');
      expectBudget(() => convertDocumentsToTailwind(documents, '/*éé*/', {
        strict, limits: { cssBytes: 7 },
      }), 'cssBytes');
    }
  });

  it('never swallows expanded candidate or inline limits in matcher/parser catches', () => {
    expectBudget(() => convertDocumentsToTailwind(documents, '.card{border:1px solid red}', {
      strict: true, limits: { expandedCandidates: 4 },
    }), 'expandedCandidates');
    expectBudget(() => convertDocumentsToTailwind([{ id: 'inline', html: '<div style="padding:4px"></div>' }], '', {
      strict: true, limits: { expandedCandidates: 3 },
    }), 'expandedCandidates');
    expectBudget(() => convertDocumentsToTailwind(documents, '.card{display:flex;color:red}', {
      strict: true, limits: { candidatesPerElement: 1 },
    }), 'candidatesPerElement');
    expectBudget(() => convertDocumentsToTailwind([{ id: 'inline', html: '<div style="color:red;opacity:.5"></div>' }], '', {
      limits: { expandedCandidates: 1 },
    }), 'expandedCandidates');
  });

  it('charges retained winners rather than discarded duplicate work to the heap budget', () => {
    const pages = [{ id: 'broad', html: '<div class="card"></div>'.repeat(251) }];
    const css = '.card{display:block;display:flex}'.repeat(1000);
    const result = convertDocumentsToTailwind(pages, css, { strict: true, limits: { expandedCandidates: 251 } });
    expect(cheerio.load(result.documents[0].html)('.card.flex')).toHaveLength(251);
    expectBudget(() => convertDocumentsToTailwind(pages, css, {
      strict: true, limits: { candidateVisits: 1000 },
    }), 'candidateVisits');
    const released = convertDocumentsToTailwind(pages, '.card{display:flex;color:red}', {
      strict: true, limits: { expandedCandidates: 2 },
    });
    expect(cheerio.load(released.documents[0].html)('.card.flex')).toHaveLength(251);
    expectBudget(() => convertDocumentsToTailwind(pages, '.card{display:flex;color:red}', {
      strict: true, limits: { expandedCandidates: 1 },
    }), 'expandedCandidates');
  });

  it('exports more than 250k aggregate winners while retaining only one element cascade', () => {
    const count = 21_000; // border expands to 12 winners per element: 252,000 total.
    const result = convertDocumentsToTailwind([
      { id: 'large', html: '<div class="card"></div>'.repeat(count) },
    ], '.card{border:1px solid red}', { strict: true, limits: { expandedCandidates: 12 } });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('.card')).toHaveLength(count);
    expect(dom('.card').first().attr('class')).toContain('[border-width:1px]');
    expect(dom('.card').last().attr('class')).toContain('[border-width:1px]');
    expect(result.stats.declarationsConverted).toBe(1);
  });

  it('matches ancestor, sibling, :has and exact attributes against the unchanged full document', () => {
    const source = '<style>.unused{color:red}</style><section class="parent" style="color:red">' +
      '<div class="first" style="display:block"></div><span class="later"></span></section>';
    const result = convertDocumentsToTailwind([{ id: 'selectors', html: source }], `
      .first{padding:4px}
      [class="parent"][style] > [class="later"]{display:flex}
      [style] + .later{color:blue}
      section:has(.first[style]):has(> .later){opacity:.5}
      html:has(style) .later{width:20px}
    `, { strict: true, limits: { expandedCandidates: 8 } });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('.later').attr('class')).toContain('flex');
    expect(dom('.later').attr('class')).toContain('text-[color:blue]');
    expect(dom('.later').attr('class')).toContain('w-[20px]');
    expect(dom('section').attr('class')).toContain('opacity-[.5]');
    expect(dom('[style], style')).toHaveLength(0);
    expect(result.stats.inlineDeclarationsConverted).toBe(2);
  });

  it('prunes only dead custom-property dependency graphs, retaining transitive CSS and inline references', () => {
    const source = '<div class="card" style="--inline:var(--fallback);color:var(--inline)"></div>';
    const result = convertDocumentsToTailwind([{ id: 'variables', html: source }], `
      :root{--ink:var(--base,var(--backup));--base:red;--backup:blue;--fallback:orange;
        --dead:var(--dead-child);--dead-child:black;--cycle-a:var(--cycle-b);--cycle-b:var(--cycle-a);
        --tw-unused:0;--quoted:red;--animation-ink:purple}
      @property --tw-unused{syntax:"*";inherits:false;initial-value:0}
      .missing{color:var(--tw-unused)}
      .card{background-color:var(--ink);content:"var(--quoted)"}
      @keyframes paint{to{color:var(--animation-ink)}}
    `, { strict: true });
    const utilities = result.utilities!.join(' ');
    for (const name of ['ink', 'base', 'backup', 'fallback', 'inline', 'animation-ink'])
      expect(utilities).toContain(`[--${name}:`);
    for (const name of ['dead', 'dead-child', 'cycle-a', 'cycle-b', 'tw-unused', 'quoted'])
      expect(utilities).not.toContain(`[--${name}:`);
    expect(utilities).toContain('[content:"var(--quoted)"]');
    expect(result.stats.inlineDeclarationsConverted).toBe(2);
    const conservative = convertDocumentsToTailwind([{ id: 'variables', html: source }], ':root{--dead:red}');
    expect(conservative.residualCss).toContain('--dead:red');
  });

  it('retains custom properties observed by style queries or uncertain escaped CSS syntax', () => {
    const queried = convertDocumentsToTailwind(documents, ':root{--query:red;--dead:blue}@container style(--query:red){.card{color:red}}', { strict: true });
    expect(queried.utilities!.join(' ')).toContain('[--query:red]');
    expect(queried.utilities!.join(' ')).not.toContain('[--dead:blue]');
    const escaped = convertDocumentsToTailwind(documents, String.raw`:root{--ink:red;--dead:blue}.card{color:var(--\\69nk)}`, { strict: true });
    expect(escaped.utilities!.join(' ')).toContain('[--dead:blue]');
  });

  it('retains variable definitions only where self, descendants or pseudo-elements can consume them', () => {
    const result = convertDocumentsToTailwind([{ id: 'local', html: '<section><div class="consumer"></div><aside><span></span></aside></section>' }], `
      *{--ink:var(--base);--base:red;--dead:blue}
      .consumer{color:var(--ink)}
      .consumer::before{content:var(--label)}
      *{--label:"hello"}
    `, { strict: true });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('section').attr('class')).toContain('[--ink:var(--base)]');
    expect(dom('.consumer').attr('class')).toContain('[--base:red]');
    expect(dom('.consumer').attr('class')).toContain('[--label:"hello"]');
    expect(dom('aside, span').filter('[class]')).toHaveLength(0);
    expect(result.utilities!.join(' ')).not.toContain('[--dead:blue]');
  });

  it('avoids broad conditional variable reset output while retaining consumers and ancestors', () => {
    const support = '(((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))';
    const defaults = Array.from({ length: 40 }, (_, i) => `--reset-${i}:0`).join(';');
    const result = convertDocumentsToTailwind([{ id: 'resets', html: '<section><i class="consumer"></i></section>' + '<div></div>'.repeat(500) }], `
      @supports ${support}{*{${defaults}}}
      .consumer{opacity:var(--reset-0)}
    `, { strict: true, limits: { generatedClassBytes: 4096, expandedCandidates: 2 } });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('div').filter('[class]')).toHaveLength(0);
    expect(dom('section').attr('class')).toContain('[--reset-0:0]');
    expect(dom('.consumer').attr('class')).toContain('[--reset-0:0]');
    expect(result.utilities!.join(' ')).not.toContain('[--reset-1:0]');
  });

  it('does not generate absent pseudo boxes or duplicate their universal resets', async () => {
    const source = '<div class="plain"></div><div class="label"></div><div class="removed"></div>';
    const css = '* ,::before,::after,::backdrop{--ink:red;box-sizing:border-box;border:0 solid red}' +
      '::before,::after{--content:""}.label::before{content:"Label";color:var(--ink)}' +
      '.removed::before{content:"Old"}.removed::before{content:none}';
    const result = convertDocumentsToTailwind([{ id: 'pseudo-resets', html: source }], css, { strict: true });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('.plain').attr('class')).not.toMatch(/before:|after:|backdrop/);
    expect(dom('.removed').attr('class')).not.toContain('before:');
    expect(dom('.label').attr('class')).toContain('before:[content:"Label"]');
    expect(dom('.label').attr('class')).toContain('before:[--ink:red]');
    expect(dom('.label').attr('class')).not.toContain('after:');
    expect(result.utilities!.join(' ')).not.toContain('--content');
    const compiled = await compile(result.utilities!);
    expect(compiled).toContain('border-width: 0');
  });

  it('keeps universal resets compact across eight large captured pages under the default byte budget', () => {
    const css = '*,::before,::after,::backdrop{box-sizing:border-box;border:0 solid rgb(229,231,235)}' +
      '::before,::after{--content:""}';
    const result = convertDocumentsToTailwind(Array.from({ length: 8 }, (_, i) => ({
      id: String(i), html: '<div></div>'.repeat(8000),
    })), css, { strict: true });
    expect(result.documents).toHaveLength(8);
    expect(Buffer.byteLength(result.documents.map(document => document.html).join(''))).toBeLessThan(8 * 1024 * 1024);
    expect(result.utilities).toEqual(expect.arrayContaining(['[border-width:0]', '[border-style:solid]']));
    expect(result.utilities!.join(' ')).not.toMatch(/before:|after:|backdrop/);
  });

  it('bounds conditional fanout and nested activation sets', () => {
    const css = Array.from({ length: 4 }, (_, i) => `@media(min-width:${i}px){.card{color:red}}`).join('');
    expectBudget(() => convertDocumentsToTailwind(documents, css, {
      strict: true, limits: { conditionsPerGroup: 3 },
    }), 'conditionsPerGroup');
    expectBudget(() => convertDocumentsToTailwind(documents, '@media(min-width:1px){@supports(display:grid){.card:hover{color:red}}}', {
      strict: true, limits: { conditionsPerCandidate: 2 },
    }), 'conditionsPerCandidate');
  });

  it('bounds unique utilities, utility bytes and generated class strings', () => {
    for (const strict of [true, false]) {
      expectBudget(() => convertDocumentsToTailwind(documents, '.card{display:flex;color:red}', {
        strict, limits: { utilityCount: 1 },
      }), 'utilityCount');
      expectBudget(() => convertDocumentsToTailwind(documents, '.card{display:flex}', {
        strict, limits: { utilityBytes: 3 },
      }), 'utilityBytes');
      expectBudget(() => convertDocumentsToTailwind(documents, '.card{display:flex}', {
        strict, limits: { classLength: 3 },
      }), 'classLength');
      expectBudget(() => convertDocumentsToTailwind(documents, '.card{display:flex}', {
        strict, limits: { elementClassLength: 8 },
      }), 'elementClassLength');
      expectBudget(() => convertDocumentsToTailwind(documents, '.card{display:flex}', {
        strict, limits: { generatedClassBytes: 4 },
      }), 'generatedClassBytes');
    }
  });

  it('bounds conservative target and nonconvertible layout match products', () => {
    const pages = [{ id: 'many', html: '<div class="card"></div>'.repeat(4) }];
    expectBudget(() => convertDocumentsToTailwind(pages, '.card{color:red;color:blue}', {
      limits: { expandedCandidates: 7 },
    }), 'expandedCandidates');
    // These complex-selector declarations never become migration candidates.
    expectBudget(() => convertDocumentsToTailwind(pages, 'div.card{inline-size:4px;min-inline-size:2px}', {
      limits: { expandedCandidates: 7 },
    }), 'expandedCandidates');
    expectBudget(() => convertDocumentsToTailwind(pages, 'div.card{inline-size:4px;min-inline-size:2px}', {
      limits: { candidatesPerElement: 1 },
    }), 'candidatesPerElement');
  });

  it('deduplicates repeated warnings and aborts excessive unique warnings', () => {
    const result = convertDocumentsToTailwind([{ id: 'many', html: '<div class="card"></div>'.repeat(100) }], '.card{padding:0r}', {
      strict: true, limits: { warningCount: 1 },
    });
    expect(result.warnings).toHaveLength(1);
    expectBudget(() => convertDocumentsToTailwind(documents, '.card{padding:0r;margin:0r}', {
      strict: true, limits: { warningCount: 1 },
    }), 'warningCount');
    expectBudget(() => convertDocumentsToTailwind(documents, '.card{padding:0r}', {
      strict: true, limits: { warningBytes: 10 },
    }), 'warningBytes');
  });

  it('compacts broad duplicate declarations without changing cascade winners', () => {
    const source = '<div id="hero" class="card"></div>' + '<div class="card"></div>'.repeat(99);
    const css = '@layer reset, utilities;@layer reset{*{color:red!important}}' +
      Array.from({ length: 100 }, () => '.card{display:block;display:flex}').join('') +
      '.card:hover{display:grid}.card:hover{display:inline}#hero{display:block}' +
      '@layer utilities{.card{color:blue!important}}';
    const result = convertDocumentsToTailwind([{ id: 'broad', html: source }], css, {
      strict: true, limits: { candidatesPerElement: 3, conditionsPerGroup: 2 },
    });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('#hero').hasClass('block')).toBe(true);
    expect(dom('#hero').hasClass('hover:inline')).toBe(false);
    expect(dom('div').last().hasClass('flex')).toBe(true);
    expect(dom('div').last().hasClass('hover:inline')).toBe(true);
    expect(dom('div').last().attr('class')).toContain('!text-[color:red]');
    expect(result.utilities).not.toContain('hover:grid');
    expect(result.utilities).not.toContain('!text-[color:blue]');
  });
  it('converts layered resets, theme variables and nested utilities using native layer priority', async () => {
    const source = '<div id="hero" class="card"><span>Text</span></div>';
    const css = `@layer reset, theme, components, utilities;
      @layer reset { * { box-sizing:border-box } body { margin:0 } }
      @layer theme { :root { --space:20px; --ink:#123456 } }
      @layer utilities { .card { display:flex; padding:var(--space); color:var(--ink); & > span { font-size:24px } } }
      @layer components { #hero { display:block; color:red } }
      @layer reset { #hero { background:red!important } }
      @layer utilities { .card { background:blue!important } }
      #hero { background:green!important }`;
    const result = convertDocumentsToTailwind([{ id: 'layers', html: source }], css, { strict: true });
    const dom = cheerio.load(result.documents[0].html);
    expect(dom('#hero').hasClass('flex')).toBe(true);
    expect(dom('#hero').attr('class')).toContain('!bg-[color:red]');
    expect(dom('span').attr('class')).toContain('text-[length:24px]');
    expect(dom('html').attr('class')).toContain('[--space:20px]');
    expect(result.warnings.some(warning => /layered|@layer/.test(warning.message))).toBe(false);
    const compiled = await compile(result.utilities!);
    expect(compiled).toContain('--ink: #123456');
    if (!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')) return;
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      const capture = () => page.locator('#hero').evaluate(element => {
        const style = getComputedStyle(element);
        return { display: style.display, padding: style.padding, color: style.color, background: style.backgroundColor, boxSizing: style.boxSizing, childSize: getComputedStyle(element.firstElementChild!).fontSize };
      });
      await page.setContent(`<style>${css}</style>${source}`);
      const before = await capture();
      await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
      expect(await capture()).toEqual(before);
    } finally { await browser.close(); }
  });

  it('respects nested and anonymous layers, unlayered rules and reversed important layer order', () => {
    const result = convertDocumentsToTailwind([{ id: 'layers', html: '<div id="hero" class="card"></div>' }], `
      @layer framework { @layer reset, widgets; @layer widgets { #hero { display:block; color:blue!important } } @layer reset { .card { display:grid; color:red!important } } }
      @layer { .card { display:flex } }
      .card { display:inline }`, { strict: true });
    const classes = cheerio.load(result.documents[0].html)('#hero').attr('class')!;
    expect(classes).toContain('inline');
    expect(classes).toContain('!text-[color:red]');
    expect(classes).not.toMatch(/block|grid|flex|blue/);
  });
  it('retains desktop banner rules when screen media queries overlap and ignores invalid lengths', async () => {
    const source = '<div class="hero"><img id="phone" class="phone"></div><a class="link">Home</a><div id="nav" class="nav"></div>';
    const css = '.hero{position:relative;width:400px;height:300px}.nav{padding:5px 0}.nav{padding:0r 0}a{font:inherit}.link{font-size:18px;line-height:150%}@media screen and (min-width:800px){.phone{position:absolute;width:100%;height:100%;top:0;left:0}}@media screen and (max-width:800px){.phone{position:absolute;width:100%;height:100%;top:0;left:0}}';
    const result = convertDocumentsToTailwind([{ id: 'banner', html: source }], css, { strict: true });
    expect(result.warnings.some(warning => /lower-priority declaration omitted/.test(warning.message))).toBe(false);
    expect(cheerio.load(result.documents[0].html)('#nav').attr('class')).toContain('py-[5px]');
    expect(result.utilities).not.toContain('[font:inherit]');
    if (!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')) return;
    const compiled = await compile(result.utilities!);
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      for (const width of [1280, 800, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
        expect(await page.locator('#phone').evaluate(element => getComputedStyle(element).position)).toBe('absolute');
        expect(await page.locator('#phone').evaluate(element => getComputedStyle(element).width)).toBe('400px');
        expect(await page.locator('a').evaluate(element => getComputedStyle(element).fontSize)).toBe('18px');
      }
    } finally { await browser.close(); }
  });
  it('removes every original styling source and compiles advanced arbitrary utilities', async () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html: `<style>${css}</style><link rel="stylesheet" href="bootstrap.css">${html}` }], css, { strict: true });
    const $ = cheerio.load(result.documents[0].html);
    expect($('[style], style, link[rel="stylesheet"]')).toHaveLength(0);
    expect(result.residualCss).toBe('');
    expect(result.stats.declarationsPreserved).toBe(0);
    expect(result.stats.inlineDeclarationsConverted).toBe(3);
    const compiled = await compile(result.utilities!);
    expect(compiled).toContain('@media (max-width:600px)');
    expect(compiled).toContain('::before');
    expect(compiled).toContain('hello_world');
    expect(compiled).toContain('linear-gradient(red,blue)');
    expect(compiled).not.toContain('.container {');
  });

  it('places readable native classes on matched elements, never the root', () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html: '<main><div class="card"><span>Text</span></div><aside>Other</aside></main>' }], '.card{display:flex;padding:20px;gap:4px}.card:hover{display:grid}.card:hover span{color:blue}@media(max-width:600px){.card{padding:8px}}', { strict: true });
    const $ = cheerio.load(result.documents[0].html);
    const classes = $('.card').attr('class')!.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['flex', 'p-5', 'gap-1', 'hover:grid', '[@media_(max-width:600px)]:p-2']));
    expect($('span').attr('class')).toContain('[.card:hover_&]:text-[color:blue]');
    expect($('html, main, aside').filter('[class]')).toHaveLength(0);
    expect(result.documents[0].html).not.toMatch(/data-tw-(rules|inline)|tw-inline-specificity|@media_all|\/\*p/);
  });

  it('resolves selector-list specificity, important and inline shorthand priority before emission', () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html: '<div id="hero" class="card" style="color:orange;padding:12px;padding-left:7px"></div><div class="other"></div>' }], '.card{color:red;padding:20px}#hero,.other{color:purple}.card{color:green!important;padding-left:40px}.card:hover{color:blue}.other{display:block}div.other{display:flex}.other{display:grid}', { strict: true });
    const $ = cheerio.load(result.documents[0].html);
    expect($('#hero').attr('class')).toContain('!text-[color:green]');
    expect($('#hero').attr('class')).toContain('py-3');
    expect($('#hero').attr('class')).toContain('pr-3');
    expect($('#hero').attr('class')).toContain('pl-[7px]');
    expect($('#hero').attr('class')).not.toMatch(/orange|purple|blue|pl-10|p-5/);
    expect($('.other').attr('class')).toContain('flex');
    expect($('.other').attr('class')).not.toMatch(/block|grid/);
  });

  it('resolves :is and :where specificity and escaped selectors independently for each document', () => {
    const result = convertDocumentsToTailwind([{ id: 'a', html: '<div class="a:b low"></div>' }, { id: 'b', html: '<div class="low"></div>' }], '.a\\\\:b{display:flex}:where(#missing,.low){display:block}:is(#missing,.low){display:grid}.low{display:inline}', { strict: true });
    for (const document of result.documents) {
      const $ = cheerio.load(document.html);
      expect($('div').attr('class')).toContain('grid');
      expect($('div').attr('class')).not.toMatch(/flex|block|inline/);
    }
  });

  it('expands background, border, flex and radius shorthands before longhand overrides', () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html: '<div class="card"></div>' }], '.card{background:linear-gradient(red,blue);background-color:yellow;border:2px solid black;border-left-width:7px;flex:1;border-radius:8px;border-top-left-radius:3px}', { strict: true });
    const classes = cheerio.load(result.documents[0].html)('.card').attr('class')!;
    expect(classes).toContain('[background-image:linear-gradient(red,blue)]');
    expect(classes).toContain('bg-[color:yellow]');
    expect(classes).not.toContain('bg-[color:transparent]');
    expect(classes).toContain('[border-left-width:7px]');
    expect(classes).not.toContain('[border-left-width:2px]');
    expect(classes).toContain('grow-[1]');
    expect(classes).toContain('basis-[0%]');
    expect(classes).toContain('[border-top-left-radius:3px]');
    expect(classes).not.toContain('[border-top-left-radius:8px]');
  });

  it('leaves conservative conversion behavior unchanged', () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html: '<div class="card"></div>' }], '.card{color:red}.card{color:blue}');
    expect(result.residualCss).toContain('color:red');
    expect(result.residualCss).toContain('color:blue');
    expect(result.warnings).toHaveLength(1);
  });

  it('keeps literal asset URL underscores without introducing a backslash into filenames', async () => {
    const result = convertDocumentsToTailwind([{ id: 'asset', html: '<div class="card"></div>' }], '.card{background-image:url("assets/golden_hour.webp")}', { strict: true });
    expect(result.utilities!.join(' ')).toContain('golden_hour.webp');
    expect(result.utilities!.join(' ')).not.toContain('golden\\_hour.webp');
    expect(await compile(result.utilities!)).toContain('golden_hour.webp');
  });

  it('reports unsupported effects rather than retaining custom styles', () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html }], '@font-face{font-family:Custom;src:url(font.woff2)}@keyframes custom{to{opacity:0}}', { strict: true });
    expect(result.warnings.map(warning => warning.message).join(' ')).toContain('@font-face');
    expect(result.warnings.map(warning => warning.message).join(' ')).toContain('@keyframes');
    expect(result.residualCss).toBe('');
  });

  it.skipIf(!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe'))('preserves overlapping responsive, focus, important and inline cascades', async () => {
    const sourceHtml = '<button id="target" class="button" style="padding:12px;padding-left:7px">Text</button>';
    const sourceCss = '.button{color:red;padding:24px;display:block}@media(max-width:900px){.button{color:blue;display:flex}}@media(min-width:400px){.button{color:green;display:grid}}.button:hover{color:purple}.button:focus{color:orange}.button{border:2px solid black!important}.button:hover{border-left:5px dashed red!important}';
    const result = convertDocumentsToTailwind([{ id: 'one', html: sourceHtml }], sourceCss, { strict: true });
    const compiled = await compile(result.utilities!);
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      const capture = () => page.locator('#target').evaluate(element => {
        const style = getComputedStyle(element);
        return { color: style.color, display: style.display, padding: style.padding, border: style.border, borderLeft: style.borderLeft };
      });
      for (const width of [1000, 500, 300]) {
        await page.setViewportSize({ width, height: 700 });
        for (const state of ['base', 'hover', 'focus']) {
          const applyState = async () => {
            await page.mouse.move(width - 1, 650);
            if (state === 'hover') await page.locator('#target').hover();
            if (state === 'focus') await page.locator('#target').focus();
          };
          await page.setContent(`<style>${sourceCss}</style>${sourceHtml}`);
          await applyState();
          const expected = await capture();
          await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
          await applyState();
          expect(await capture()).toEqual(expected);
        }
      }
    } finally { await browser.close(); }
  });

  it.skipIf(!existsSync(chromium.executablePath()) && !existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe'))('matches source computed styles at desktop/mobile, hover and pseudo-elements', async () => {
    const result = convertDocumentsToTailwind([{ id: 'one', html }], css, { strict: true });
    const compiled = await compile(result.utilities!);
    const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    try {
      const page = await browser.newPage();
      const capture = () => page.locator('#hero').evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.width, display: style.display, color: style.color, padding: style.padding, gap: style.gap, background: style.backgroundImage, backgroundColor: style.backgroundColor, border: style.border, shadow: style.boxShadow, transform: style.transform, before: getComputedStyle(element, '::before').content, child: getComputedStyle(element.querySelector('span')!).color };
      });
      for (const width of [1000, 500]) {
        for (const hovered of [false, true]) {
          await page.setViewportSize({ width, height: 700 });
          await page.setContent(`<style>${css}</style>${html}`);
          if (hovered) await page.locator('#hero').hover();
          else await page.mouse.move(900, 650);
          const before = await capture();
          await page.setContent(result.documents[0].html.replace(/<head[^>]*>/i, match => `${match}<style>${compiled}</style>`));
          if (hovered) await page.locator('#hero').hover();
          else await page.mouse.move(900, 650);
          expect(await capture()).toEqual(before);
        }
      }
    } finally { await browser.close(); }
  });
});
