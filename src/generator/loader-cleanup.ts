import * as cheerio from 'cheerio';
import postcss from 'postcss';

const content = 'main,header,footer,nav,article,section,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],h1,h2,h3,video,audio,form';
const loaderName = /(?:^|[\s_-])(?:pre-?loader|page-?loader|site-?loader|loading-?(?:screen|overlay|indicator|spinner)|loader|spinner|splash-?(?:screen|loader)|animate-intro)(?:$|[\s_-])/i;
const lockName = /^(?:loading|is-loading|page-loading|preloading|preloader-active|modal-open|no-scroll|noscroll|scroll-locked|overflow-hidden|overflow-y-hidden)$/i;

/** Remove transient loaders from saved HTML, including snapshots made before browser marking existed. */
export function removeSnapshotLoaders(html: string, warnings: string[]): { html: string; removed: number } {
  const $ = cheerio.load(html);
  const candidates = $('body *').toArray();
  const positioned = new Set<(typeof candidates)[number]>();
  const coveringRules = new Set<(typeof candidates)[number]>();
  // Source CSS is available here before export strips styles or renames classes.
  // Only inspect fixed positioning; decorative geometry below provides a second
  // independent signal, so generic .fixed classes cannot remove genuine content.
  for (const element of $('style').toArray()) {
    try {
      postcss.parse($(element).text()).walkRules(rule => {
        if (!rule.nodes.some(node => node.type === 'decl' && node.prop === 'position' && node.value.trim() === 'fixed')) return;
        const declarations = rule.nodes.filter(node => node.type === 'decl');
        const fullScreen = declarations.some(decl => decl.prop === 'inset' && /^0(?:px)?$/.test(decl.value.trim())) ||
          (declarations.some(decl => decl.prop === 'width' && /^100(?:vw|%)$/.test(decl.value.trim())) && declarations.some(decl => decl.prop === 'height' && /^100(?:d?vh|%)$/.test(decl.value.trim())));
        try { $(rule.selector).each((_, node) => { if (!('attribs' in node)) return; positioned.add(node); if (fullScreen) coveringRules.add(node); }); } catch { /* Browser-only selectors. */ }
      });
    } catch { /* Malformed CSS is handled by the normal exporter. */ }
  }
  let removed = 0;
  for (const element of candidates) {
    if (!('attribs' in element) || ['script', 'style', 'template', 'svg', 'path', 'img', 'source', 'canvas'].includes(element.tagName)) continue;
    const node = $(element);
    if (!node.parents('body').length || node.is(content) || node.find(content).length) continue;
    const names = [node.attr('id') || '', node.attr('class') || '', node.attr('aria-label') || ''].join(' ').replace(/([a-z])([A-Z])/g, '$1-$2');
    const marked = node.attr('data-captured-loader') === 'true';
    const named = loaderName.test(names) || Object.keys(element.attribs).some(name => /^(?:data-preloader|data-loader|data-loading-screen)$/.test(name));
    const inline = node.attr('style') || '';
    const classes = node.attr('class') || '';
    const fixed = positioned.has(element) || /position\s*:\s*fixed/i.test(inline) || /(?:^|\s)fixed(?:\s|$)/.test(classes);
    const fullScreen = coveringRules.has(element) || /(?:^|\s)inset-0(?:\s|$)/.test(classes) || /inset\s*:\s*0(?:px)?(?:\s|;|$)/i.test(inline) ||
      (/width\s*:\s*100(?:vw|%)/i.test(inline) && /height\s*:\s*100(?:d?vh|%)/i.test(inline));
    const text = node.clone(); text.find('style,script,template').remove();
    // A fixed full-screen decorative logo/backdrop is not page data. Do not
    // mistake menus, dialogs with controls, or editorial overlays for a loader.
    const decorative = text.text().trim().length < 120 && !node.find('a,button,input,select,textarea,[role="button"],p').length &&
      (node.attr('aria-hidden') === 'true' || node.find('img,svg').length > 0 || /loading|please wait/i.test(text.text()));
    if (!marked && !named && !(fixed && fullScreen && decorative)) continue;
    node.remove(); removed++;
  }
  if (removed) {
    $('html,body').each((_, element) => {
      const node = $(element);
      const classes = (node.attr('class') || '').split(/\s+/).filter(name => name && !lockName.test(name));
      if (classes.length) node.attr('class', classes.join(' ')); else node.removeAttr('class');
      let style = '';
      try {
        const root = postcss.parse(`x{${node.attr('style') || ''}}`);
        root.walkDecls(decl => {
          if (/^(?:overflow(?:-[xy])?|touch-action)$/i.test(decl.prop) || (decl.prop === 'position' && decl.value.trim() === 'fixed')) decl.remove();
        });
        style = (root.first as postcss.Rule).nodes.map(node => node.toString()).join(';');
      } catch { /* Keep the exported root usable even if source inline CSS is malformed. */ }
      node.attr('style', `${style}${style ? ';' : ''}overflow:auto!important;overflow-y:auto!important;`);
      node.removeAttr('aria-busy');
    });
    warnings.push(`Removed ${removed} captured loader/preloader layer(s); main content is exported without a loading screen.`);
  }
  return { html: $.html(), removed };
}
