import * as cheerio from 'cheerio';
import postcss from 'postcss';

const protectedContent = 'main, header, footer, nav, article, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"]';
const vendor = /(?:^|[\s_-])(?:cybotcookiebotdialog(?:bodyunderlay)?|google_ads_iframe[^\s]*|onetrust|cookiebot|cookie-law-info|cookie-notice|cmplz-cookiebanner|didomi-host|iubenda-cs|qc-cmp|quantcast-consent|adsbygoogle|gpt-ad|ad-slot|ad-container)(?:$|[\s_-])/i;
const named = /(?:^|[\s_-])(?:cookies?|cookie[-_ ]?(?:banner|notice|consent|bar|popup|modal)|consent[-_ ]?(?:banner|notice|modal|overlay)|(?:newsletter|promotion|promo|offer|dmca)[-_ ]?(?:popup|modal|banner|notice|overlay|interstitial)|(?:ad|ads|advert|advertisement|advertising)[-_ ]?(?:banner|slot|container|widget|overlay|unit)|popup|pop-up|modal|backdrop|interstitial)(?:$|[\s_-])/i;
const lockClass = /^(?:modal-open|popup-open|cookie-open|consent-open|no-scroll|noscroll|scroll-locked|overflow-hidden|overflow-y-hidden)$/i;

/** Exact-only snapshot cleanup; never changes crawler capture or other exporters. */
export function cleanupExactSnapshot(html: string, warnings: string[]) {
  const $ = cheerio.load(html);
  let removed = 0;
  const candidates = $('body *').toArray();
  for (const element of candidates) {
    if (!('attribs' in element) || ['script', 'style', 'template', 'svg', 'path'].includes(element.tagName)) continue;
    const node = $(element);
    const hero = /(?:^|[\s_-])hero(?:$|[\s_-])/i.test(node.attr('class') || '');
    if (!node.parents('body').length || node.is(protectedContent) || node.find(protectedContent).length || hero) continue;
    const names = [node.attr('id') || '', node.attr('class') || ''].join(' ').replace(/([a-z])([A-Z])/g, '$1-$2');
    const rawNames = [node.attr('id') || '', node.attr('class') || ''].join(' ');
    const semantic = element.tagName === 'dialog' || /^(?:dialog|alertdialog)$/i.test(node.attr('role') || '') || node.attr('aria-modal') === 'true';
    const marked = node.attr('data-captured-transient-ui') === 'true' || Object.keys(element.attribs).some(name => /^(?:data-cookie-banner|data-consent-banner|data-popup|data-modal|data-ad-slot|data-ad-client|data-newsletter-popup|data-promotion-overlay)$/.test(name));
    const fixedOverlay = /(?:^|[\s_-])overlay(?:$|[\s_-])/i.test(names) && /position\s*:\s*fixed/i.test(node.attr('style') || '');
    if (!semantic && !marked && !vendor.test(rawNames) && !named.test(names) && !fixedOverlay) continue;
    node.remove();
    removed++;
  }
  if (removed) {
    $('html, body').each((_, element) => {
      const node = $(element);
      const classes = (node.attr('class') || '').split(/\s+/).filter(name => name && !lockClass.test(name));
      if (classes.length) node.attr('class', classes.join(' ')); else node.removeAttr('class');
      let style = '';
      try {
        const root = postcss.parse(`x{${node.attr('style') || ''}}`);
        root.walkDecls(decl => {
          if (/^(?:overflow(?:-[xy])?|overscroll-behavior(?:-[xy])?)$/i.test(decl.prop) ||
              (/^position$/i.test(decl.prop) && /fixed/i.test(decl.value)) ||
              (/^touch-action$/i.test(decl.prop) && /none/i.test(decl.value))) decl.remove();
        });
        style = (root.first as postcss.Rule).nodes.map(decl => decl.toString()).join(';');
      } catch { warnings.push('Malformed root inline styles were omitted while restoring scrolling.'); }
      node.attr('style', `${style}${style ? ';' : ''}overflow:auto!important;overflow-y:auto!important;`);
    });
    warnings.push(`Removed ${removed} recognized blocking/transient/ad widget(s) from the captured snapshot; restored document scrolling. Main content, navigation and unrelated banners are retained.`);
    warnings.push('Cleanup runs on captured HTML before asset collection, not in the source browser. Overlay-hidden content absent from the snapshot cannot be recovered; re-capture it after dismissing blockers if necessary.');
    const body = $('body').clone();
    body.find('script, style, template, link, meta').remove();
    if (!body.text().trim() && !body.find('img, picture, svg, video, audio, canvas, input, button, select, textarea').length) {
      throw new Error('Removing recognized blockers emptied the useful captured body. Re-capture the source after dismissing its overlay.');
    }
  }
  return { html: $.html(), removed };
}
