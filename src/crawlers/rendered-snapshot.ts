import type { Page } from 'playwright';

/** Serialize CSSOM-inserted styles (styled-components, Emotion, adopted sheets) with HTML. */
export async function captureRenderedHtml(page: Page): Promise<string> {
  const capture = () => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const originalStyles = Array.from(document.querySelectorAll('style'));
    const copiedStyles = Array.from(clone.querySelectorAll('style'));
    for (let index = 0; index < originalStyles.length; index++) {
      const sheet = originalStyles[index].sheet;
      if (!sheet || !copiedStyles[index]) continue;
      try {
        const css = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
        if (css) copiedStyles[index].textContent = css;
      } catch { /* Inaccessible sheets retain their original text. */ }
    }
    // Preserve stylesheets the browser has already loaded using its page session.
    // A later standalone fetch can be denied even though the rendered page is styled.
    // Read only accessible CSSOM sheets; never fetch around cross-origin restrictions.
    const originalLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
    const copiedLinks = Array.from(clone.querySelectorAll('link[rel~="stylesheet"]'));
    let capturedBytes = 0;
    const serializeSheet = (sheet: CSSStyleSheet, visited = new Set<CSSStyleSheet>()): string => {
      if (visited.has(sheet)) return '';
      visited.add(sheet);
      const baseUrl = sheet.href || document.baseURI;
      const rebase = (css: string) => css.replace(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)]*))\s*\)/gi, (full, double: string, single: string, bare: string) => {
        const value = (double ?? single ?? bare ?? '').trim();
        if (!value || /^(?:data:|blob:|#)/i.test(value)) return full;
        try { return `url("${new URL(value, baseUrl).href.replace(/"/g, '%22')}")`; } catch { return full; }
      });
      return Array.from(sheet.cssRules, rule => {
        if (rule instanceof CSSImportRule) {
          let css: string;
          try {
            if (!rule.styleSheet) throw new Error('Unloaded stylesheet import');
            css = serializeSheet(rule.styleSheet, visited);
          } catch {
            // One cross-origin/unloaded import must not discard all readable
            // rules in the parent sheet. Keep its conditions and absolute URL
            // for the normal SSRF-validated asset resolver to handle later.
            const href = new URL(rule.href, baseUrl).href.replace(/"/g, '%22');
            return rule.cssText.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')/i, `@import url("${href}")`);
          }
          if (rule.media.mediaText) css = `@media ${rule.media.mediaText}{${css}}`;
          if (rule.supportsText) css = `@supports (${rule.supportsText}){${css}}`;
          if (rule.layerName !== null) css = `@layer ${rule.layerName}{${css}}`;
          return css;
        }
        return rebase(rule.cssText);
      }).join('\n');
    };
    for (let index = 0; index < originalLinks.length; index++) {
      const link = originalLinks[index] as HTMLLinkElement;
      const copied = copiedLinks[index];
      if (!link.sheet || link.disabled || !copied) continue;
      try {
        const css = serializeSheet(link.sheet);
        if (!css || css.length > 10 * 1024 * 1024 || capturedBytes + css.length > 20 * 1024 * 1024) continue;
        const style = document.createElement('style');
        style.setAttribute('data-captured-stylesheet', link.href);
        const media = link.getAttribute('media');
        if (media) style.setAttribute('media', media);
        style.textContent = css;
        copied.replaceWith(style);
        capturedBytes += css.length;
      } catch { /* Unreadable sheets retain their links for normal asset resolution. */ }
    }
    const head = clone.querySelector('head');
    for (const sheet of document.adoptedStyleSheets || []) {
      try {
        const style = document.createElement('style');
        style.setAttribute('data-captured-adopted-styles', '');
        style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
        head?.appendChild(style);
      } catch { /* Cross-origin sheets cannot be read; external links remain intact. */ }
    }
    // CSS/WAAPI animation end states are not serialized by outerHTML. Freeze
    // only animation/reveal targets, never globally unhide menus or dialogs.
    const originals = Array.from(document.querySelectorAll('*'));
    const copies = Array.from(clone.querySelectorAll('*'));
    const observed = (window as unknown as { __scrapeVisibleStates?: Map<Element, Record<string, string>> }).__scrapeVisibleStates;
    const animated = new Set<Element>();
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      if (effect instanceof KeyframeEffect && effect.target instanceof Element) animated.add(effect.target);
    }
    const revealSelector = '[data-aos], [data-scroll-reveal], [data-sr-id], .wow, .aos-animate';
    for (let index = 0; index < originals.length; index++) {
      const original = originals[index];
      const copy = index === 0 ? clone : copies[index - 1];
      if (!copy || !(copy instanceof HTMLElement || copy instanceof SVGElement)) continue;
      const computed = getComputedStyle(original);
      // Mark opaque full-screen logo/loading layers while computed geometry is
      // available. Never delete during this loop: original/copy indices must align.
      const bounds = original.getBoundingClientRect();
      const loaderNames = [original.id, original.getAttribute('class') || '', original.getAttribute('aria-label') || ''].join(' ').replace(/([a-z])([A-Z])/g, '$1-$2');
      const namedLoader = /(?:^|[\s_-])(?:pre-?loader|page-?loader|site-?loader|loading-?(?:screen|overlay|indicator|spinner)|loader|spinner|splash-?screen|animate-intro)(?:$|[\s_-])/i.test(loaderNames);
      const protectsContent = original.matches('html,body,main,header,footer,nav,section,article') ||
        !!original.querySelector('main,header,footer,nav,section,article,h1,h2,h3,video,audio,form');
      const covering = computed.position === 'fixed' && bounds.width >= innerWidth * 0.9 && bounds.height >= innerHeight * 0.9;
      const decorative = (original.textContent || '').trim().length < 120 &&
        !original.querySelector('a,button,input,select,textarea,[role="button"],p') &&
        (original.getAttribute('aria-hidden') === 'true' || !!original.querySelector('img,svg') || /loading|please wait/i.test(original.textContent || ''));
      if (!protectsContent && (namedLoader || (covering && decorative))) copy.setAttribute('data-captured-loader', 'true');
      // Runtime CSS often uses opaque hashed classes. Mark fixed/sticky notice
      // containers using their text and controls so the static exporter can omit
      // them without depending on a particular consent vendor's class names.
      if (['fixed', 'sticky'].includes(computed.position) &&
          !original.matches('html,body,main,header,footer,nav') &&
          original.querySelector('button,[role="button"],input[type="button"],input[type="submit"]')) {
        const walker = document.createTreeWalker(original, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        while (walker.nextNode()) parts.push(walker.currentNode.textContent || '');
        const text = parts.join(' ');
        const controls = Array.from(original.querySelectorAll('button,[role="button"],input')).map(control =>
          control.textContent || control.getAttribute('value') || control.getAttribute('aria-label') || '').join(' ');
        const notice = /\b(cookies?|consent|newsletter|subscribe|special offer|dmca)\b|your privacy choices|privacy preferences/i.test(text);
        const dismiss = /\b(close|dismiss|accept|reject|agree|got it|no thanks|save|confirm)\b/i.test(controls) ||
          original.querySelector('[aria-label*="close" i],[aria-label*="dismiss" i]');
        if (text.length < 6000 && notice && dismiss) copy.setAttribute('data-captured-transient-ui', 'true');
      }
      const isAnimated = animated.has(original) || computed.animationName !== 'none';
      const isReveal = original.matches(revealSelector);
      const visibleState = observed?.get(original);
      if (!isAnimated && !isReveal && !visibleState) continue;
      if (original.closest('dialog,[hidden],[aria-hidden="true"],[inert],[role="menu"],[role="dialog"]')) continue;
      // A hidden target may be deliberately hidden; retain its captured state.
      // Non-hidden revealed targets must not replay their initial opacity/transform.
      for (const property of ['opacity', 'visibility', 'transform', 'translate', 'rotate', 'scale', 'clip-path', 'filter']) {
        const value = visibleState?.[property] || computed.getPropertyValue(property);
        if (value) copy.style.setProperty(property, value, 'important');
      }
      copy.style.setProperty('animation', 'none', 'important');
      copy.style.setProperty('transition', 'none', 'important');
      copy.setAttribute('data-captured-animation-state', '');
    }
    // Review the live source before scripts/custom controls are stripped. Runtime
    // properties capture JS-driven playback that outerHTML alone cannot describe.
    const videos = Array.from(document.querySelectorAll('video'));
    const copiedVideos = Array.from(clone.querySelectorAll('video'));
    for (let index = 0; index < videos.length; index++) {
      const video = videos[index];
      const copy = copiedVideos[index];
      if (!copy) continue;
      const computed = getComputedStyle(video);
      const bounds = video.getBoundingClientRect();
      const names = [video.id, video.className, video.parentElement?.id || '', video.parentElement?.className || ''].join(' ').replace(/([a-z])([A-Z])/g, '$1-$2');
      const namedBackground = /(?:^|[\s_-])(?:background-video|video-background|bg-video|video-bg)(?:$|[\s_-])/i.test(names);
      const parentBounds = video.parentElement?.getBoundingClientRect();
      const coversParent = !!parentBounds && parentBounds.width > 0 && parentBounds.height > 0 && bounds.width >= parentBounds.width * 0.9 && bounds.height >= parentBounds.height * 0.9;
      const decorative = !!video.closest('[aria-hidden="true"]') || computed.pointerEvents === 'none';
      const behindContent = ['absolute', 'fixed'].includes(computed.position) && computed.objectFit === 'cover' && coversParent &&
        !!video.parentElement?.querySelector('h1,h2,h3,p,a,button');
      // Autoplay/muted/loop and "hero-video" alone also describe foreground reels.
      const background = !video.controls && (namedBackground || decorative || behindContent);
      copy.setAttribute('data-captured-video-review', JSON.stringify({
        version: 1, role: background ? 'background' : 'foreground',
        controls: video.controls, autoplay: video.autoplay,
        playing: !video.paused && !video.ended && video.readyState >= 2,
        muted: video.muted, loop: video.loop, playsInline: video.playsInline,
        visible: video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && bounds.width > 0 && bounds.height > 0,
        objectFit: computed.objectFit,
      }));
      // React initializes muted from the serialized attribute, not the source
      // property; preserve JS-assigned source state for foreground players too.
      if (video.muted) copy.setAttribute('muted', ''); else copy.removeAttribute('muted');
    }
    // Canvas pixels live outside the DOM. Preserve the rendered bitmap without
    // replacing SVG/HTML charts or requiring the source chart runtime to replay.
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const copiedCanvases = Array.from(clone.querySelectorAll('canvas'));
    for (let index = 0; index < canvases.length; index++) {
      const canvas = canvases[index];
      const copy = copiedCanvases[index];
      if (!copy || !canvas.width || !canvas.height) continue;
      try {
        const image = document.createElement('img');
        for (const attribute of Array.from(copy.attributes)) image.setAttribute(attribute.name, attribute.value);
        image.src = canvas.toDataURL('image/png');
        const bounds = canvas.getBoundingClientRect();
        // CSS dimensions, not the high-DPI backing store, determine layout.
        if (!copy.style.width && bounds.width) image.style.width = `${bounds.width}px`;
        if (!copy.style.height && bounds.height) image.style.height = `${bounds.height}px`;
        image.setAttribute('data-captured-canvas', '');
        image.alt = canvas.getAttribute('aria-label') || canvas.textContent?.trim() || 'Captured chart';
        copy.replaceWith(image);
      } catch {
        // Cross-origin/tainted canvases cannot be exported. Keep an explicit
        // marker so validation never mistakes a blank canvas for success.
        copy.setAttribute('data-captured-canvas-unavailable', 'true');
      }
    }
    // Loaders have no place in exported page data, even when source CSS hides
    // them only at an animation end state that a converter cannot reproduce.
    const loaders = clone.querySelectorAll('[data-captured-loader="true"]');
    loaders.forEach(element => element.remove());
    if (loaders.length) {
      for (const root of [clone, clone.querySelector('body')]) {
        if (!root) continue;
        for (const name of Array.from(root.classList)) {
          if (/^(?:loading|is-loading|page-loading|preloading|preloader-active|no-scroll|noscroll|scroll-locked|overflow-hidden|overflow-y-hidden)$/i.test(name)) root.classList.remove(name);
        }
        root.style.removeProperty('position');
        root.style.removeProperty('touch-action');
        root.style.setProperty('overflow', 'auto', 'important');
        root.style.setProperty('overflow-y', 'auto', 'important');
        root.removeAttribute('aria-busy');
      }
    }
    return '<!doctype html>\n' + clone.outerHTML;
  };
  // tsx/esbuild adds module-local naming helpers to nested callbacks. Supply
  // their identity implementation in the browser scope, as render readiness does.
  return page.evaluate(`(() => { const __name = (fn) => fn; return (${capture.toString()})(); })()`);
}
