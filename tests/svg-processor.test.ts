import { afterEach, describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import { HtmlSvgProcessor } from '../src/generator/assets/svg-processor.js';
import { conversionStorage } from '../src/generator/storage.js';

const ids: string[] = [];
const icon = '<svg width="24" height="24" viewBox="0 0 24 24"><!-- redundant comment --><title>Search</title><path fill="#123456" d="M0 0 L24 0 L24 24 Z"></path></svg>';
async function processor() {
  const id = `svg_test_${Date.now()}_${ids.length}`;
  ids.push(id);
  await conversionStorage.setupConversionWorkspace(id);
  return { id, svg: new HtmlSvgProcessor(id, []) };
}
afterEach(async () => { await Promise.all(ids.splice(0).map(id => conversionStorage.deleteConversion(id))); });

describe('HTML SVG optimization and extraction', () => {
  it('optimizes self-contained SVGs and reuses a single asset across nested pages', async () => {
    const { id, svg } = await processor();
    const home = load(await svg.process(icon + icon, '', 'index.html', icon));
    expect(home('svg')).toHaveLength(0);
    expect(home('img')).toHaveLength(2);
    expect(home('img').attr('alt')).toBe('Search');
    const assetPath = home('img').attr('src')!;
    expect(assetPath).toMatch(/^assets\/svgs\/svg-[a-f0-9]{64}\.svg$/);
    const asset = await conversionStorage.readFileSafe(id, assetPath);
    expect(asset).toContain('viewBox="0 0 24 24"');
    expect(asset).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(asset).not.toContain('redundant comment');
    expect(asset).toContain('fill="#123456"');
    const nested = load(await svg.process(icon, '', 'pages/about.html', icon));
    expect(nested('img').attr('src')).toBe('../' + assetPath);
    expect(svg.stats).toMatchObject({ detected: 3, extracted: 3, reused: 2, assetsCreated: 1 });
  });

  it('places larger illustrations in assets/svg and preserves accessible labels', async () => {
    const { svg } = await processor();
    const markup = icon.replace('width="24" height="24"', 'width="200" height="100" aria-label="Brand" role="img"');
    const $ = load(await svg.process(markup, '', 'index.html', markup));
    expect($('img').attr('src')).toContain('assets/svgs/');
    expect($('img').attr('alt')).toBe('Brand');
    expect($('img').attr('width')).toBe('200');
    expect($('img').attr('role')).toBe('img');
  });

  it.each([
    ['currentColor paint', icon.replace('#123456', 'currentColor'), '', undefined],
    ['CSS variable', icon.replace('#123456', 'var(--icon-color)'), '', undefined],
    ['root stylesheet', icon.replace('<svg ', '<svg class="icon" '), '.icon { fill:red }', undefined],
    ['descendant stylesheet', icon, 'path { stroke: blue }', undefined],
    ['inherited paint', '<div class="theme">' + icon + '</div>', '.theme { fill:red }', undefined],
    ['inherited attribute', '<div fill="red">' + icon + '</div>', '', undefined],
    ['image CSS conflict', icon, 'img { border: 4px solid red }', undefined],
    ['hover selector', icon, 'svg:hover path { fill:red }', undefined],
    ['animation', icon.replace('<path ', '<animate attributeName="opacity" values="0;1" dur="1s"/><path '), '', undefined],
    ['internal styles', icon.replace('<path ', '<style>path {fill:red}</style><path '), '', undefined],
    ['document use reference', icon.replace('<path ', '<use href="#shared"/><path '), '', undefined],
    ['gradient reference', icon.replace('#123456', 'url(#gradient)'), '', undefined],
    ['document ID reference', icon.replace('<svg ', '<svg id="target" '), '', undefined],
    ['responsive dimensions', icon.replace('width="24"', 'width="100%"'), '', undefined],
    ['missing dimensions', icon.replace('width="24" height="24"', ''), '', undefined],
    ['source JavaScript', icon, '', icon + '<script>document.querySelector("svg").remove()</script>'],
    ['stripped handlers', icon, '', icon.replace('<path ', '<path onmouseenter="animate()" ')],
    ['linked SVG', icon.replace('<path ', '<a href="/about">Link</a><path '), '', undefined],
    ['complex CSS', icon, 'svg:unknown-selector {fill:red}', undefined],
  ])('extracts SVG even with %s', async (_reason, markup, css, original) => {
    const { svg } = await processor();
    const $ = load(await svg.process(markup!, css!, 'index.html', original || markup!));
    expect($('svg')).toHaveLength(0);
    expect($('img')).toHaveLength(1);
    expect(svg.stats).toMatchObject({ keptInline: 0, assetsCreated: 1 });
  });

  it('does not rename IDs or alter animation targets for retained SVGs', async () => {
    const { id, svg } = await processor();
    const markup = '<svg width="24" height="24" viewBox="0 0 24 24"><path id="pulse" d="M0 0L1 1"/><animate href="#pulse" attributeName="opacity" values="0;1" dur="1s"/></svg>';
    const html = await svg.process(markup, '', 'index.html', markup);
    const result = (await conversionStorage.readFileSafe(id, load(html)('img').attr('src')!))!;
    expect(result).toContain('id="pulse"');
    expect(result).toContain('href="#pulse"');
    expect(result).toContain('attributeName="opacity"');
  });

  it('embeds matching page CSS, inherited paint and responsive rules in the asset', async () => {
    const { id, svg } = await processor();
    const markup = '<div style="color:#123456">' + icon.replace('<svg ', '<svg class="icon" ') + '</div>';
    const html = await svg.process(markup, '.icon{width:32px;fill:red}@media(min-width:700px){.icon path{stroke:blue}}', 'index.html', markup);
    const $ = load(html);
    const content = (await conversionStorage.readFileSafe(id, $('img').attr('src')!))!;
    expect(content).toContain('color:#123456');
    expect(content).toContain('fill:red');
    expect(content).toContain('@media (min-width:700px)');
    expect(content).toContain('stroke:blue');
    expect($('img').attr('style')).toContain('width:32px');
  });

  it('copies document sprite definitions and rebases nested-page asset URLs', async () => {
    const { id, svg } = await processor();
    const markup = '<svg><defs><symbol id="shared"><path d="M0 0L1 1"/></symbol></defs></svg><svg width="24" height="24"><use href="#shared"/><image href="../assets/images/photo.png"/></svg>';
    const html = await svg.process(markup, '', 'pages/about.html', markup);
    expect(load(html)('svg')).toHaveLength(0);
    const src = load(html)('img').last().attr('src')!.replace(/^\.\.\//, '');
    const content = (await conversionStorage.readFileSafe(id, src))!;
    expect(content).toContain('id="shared"');
    expect(content).toContain('href="#shared"');
    expect(content).toContain('href="../images/photo.png"');
  });

  it('reuses matching already-downloaded SVG assets', async () => {
    const { svg } = await processor();
    svg.registerAsset('assets/svgs/existing.svg', icon.replace('<!-- redundant comment -->', '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '));
    const $ = load(await svg.process(icon, '', 'index.html', icon));
    expect($('img').attr('src')).toBe('assets/svgs/existing.svg');
    expect(svg.stats.assetsCreated).toBe(0);
    expect(svg.stats.reused).toBe(1);
  });
});
