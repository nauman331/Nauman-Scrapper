import type { Page } from 'playwright';

/** Bounded readiness for static snapshots; infinite feeds/animations never block forever. */
export async function waitForRenderedContent(page: Page, timeoutMs = 20000): Promise<void> {
  const prepare = async (budget: number) => {
      const captureStarted = Date.now();
      const deadline = captureStarted + budget;
      const restoreReserve = Math.min(1000, budget * 0.15);
      const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const excluded = 'dialog,[hidden],[aria-hidden="true"],[inert],[role="menu"],[role="dialog"]';
      const revealSelector = '[data-aos],[data-sr-id],[data-scroll-reveal],.wow';
      const paintProperties = ['opacity', 'visibility', 'transform', 'translate', 'rotate', 'scale', 'clip-path', 'filter'];
      // Retain visible paint even when a scroll library resets the element on exit.
      const observed = new Map<Element, Record<string, string>>();
      (window as unknown as { __scrapeVisibleStates: typeof observed }).__scrapeVisibleStates = observed;
      const inViewport = (element: Element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth)
          return false;
        // IntersectionObserver roots are often overflow containers, not the window.
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            const bounds = parent.getBoundingClientRect();
            if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return false;
          }
        }
        return true;
      };
      const sampleVisible = () => {
        for (const element of document.querySelectorAll('body *')) {
          if (!element.textContent?.trim() || element.closest(excluded) || !inViewport(element)) continue;
          let visible = true;
          for (let parent: Element | null = element; parent; parent = parent.parentElement) {
            const paint = getComputedStyle(parent);
            if (paint.display === 'none' || paint.visibility !== 'visible' || Number(paint.opacity) < 0.99) {
              visible = false;
              break;
            }
          }
          if (!visible) continue;
          const style = getComputedStyle(element);
          const state: Record<string, string> = {};
          for (const property of paintProperties) state[property] = style.getPropertyValue(property);
          observed.set(element, state);
        }
      };
      const pendingReveal = () => Array.from(document.querySelectorAll(`h1,h2,h3,p,${revealSelector}`)).some((element) => {
        if (element.closest(excluded) || !inViewport(element)) return false;
        if (!element.textContent?.trim() && !element.matches(revealSelector)) return false;
        for (let parent: Element | null = element; parent; parent = parent.parentElement) {
          const paint = getComputedStyle(parent);
          if (paint.display === 'none') return false;
          if (Number(paint.opacity) < 0.99 || paint.visibility === 'hidden') return true;
        }
        return false;
      });
      let lastChange = Date.now();
      const observer = new MutationObserver(() => { lastChange = Date.now(); });
      observer.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
      const originalX = scrollX;
      const originalY = scrollY;
      const containerPositions = new Map<HTMLElement, { top: number; left: number }>();
      // Wait at the section that triggered the reveal, not only back at the hero.
      const settleViewport = async (limit: number, minimumWait = 1200) => {
        const started = Date.now();
        const until = Math.min(deadline, started + limit);
        while (Date.now() < until) {
          sampleVisible();
          const animating = document.getAnimations().some((animation) => {
            const effect = animation.effect;
            const timing = effect?.getComputedTiming();
            return animation.playState === 'running' && timing && Number.isFinite(Number(timing.endTime)) &&
              effect instanceof KeyframeEffect && effect.target instanceof Element && inViewport(effect.target) &&
              !effect.target.closest(excluded);
          });
          if (Date.now() - started >= minimumWait && Date.now() - lastChange >= 200 && !animating && !pendingReveal()) break;
          await delay(Math.min(100, Math.max(0, until - Date.now())));
        }
        sampleVisible();
      };
      const sweep = async (container?: HTMLElement) => {
        let position = 0;
        let bottomRounds = 0;
        while (Date.now() < deadline - restoreReserve && bottomRounds < 2) {
          const viewport = container ? container.clientHeight : innerHeight;
          const height = container ? container.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
          const bottom = Math.max(0, height - viewport);
          position = Math.min(position, bottom);
          if (container) container.scrollTo({ top: position, behavior: 'instant' });
          else window.scrollTo({ top: position, behavior: 'instant' });
          // Reserve time to reach the footer on long pages; a fixed delay per
          // viewport can exhaust the entire budget before lower sections appear.
          const remainingSteps = Math.max(1, Math.ceil((bottom - position) / Math.max(100, viewport * 0.75)) + 2);
          const available = Math.max(0, deadline - Date.now() - restoreReserve);
          // Do not impose a 100ms floor: on a long directory that consumes the
          // whole budget before reaching the information sections near its end.
          const slice = Math.min(2500, available / remainingSteps);
          await settleViewport(slice, Math.min(1200, slice * 0.6));
          // Discover roots as lazy sections mount. Visit them while their parent
          // section is in view; scrolling a clipped offscreen root cannot reveal it.
          if (!container) {
            for (const root of document.querySelectorAll<HTMLElement>('body *')) {
              if (Date.now() >= deadline - restoreReserve) break;
              if (root.clientHeight < 100 || root.scrollHeight <= root.clientHeight + 1 ||
                  containerPositions.has(root) || !/(auto|scroll)/.test(getComputedStyle(root).overflowY) ||
                  root.closest(excluded) || !inViewport(root)) continue;
              containerPositions.set(root, { top: root.scrollTop, left: root.scrollLeft });
              await sweep(root);
            }
          }
          const nextHeight = container ? container.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
          const nextBottom = Math.max(0, nextHeight - viewport);
          bottomRounds = position >= nextBottom ? bottomRounds + 1 : 0;
          position = Math.min(nextBottom, position + Math.max(100, viewport * 0.75));
        }
      };
      try {
        await Promise.race([document.fonts?.ready || Promise.resolve(), delay(Math.min(2000, budget / 4))]);
        // Long directories can put editorial sections after thousands of cards.
        // Give semantic section landmarks a bounded first pass so expensive DOM
        // sampling cannot starve lower scroll observers before the linear sweep.
        const pageHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
        if (pageHeight > innerHeight * 8) {
          const landmarks = Array.from(document.querySelectorAll<HTMLElement>('section,article'))
            .filter(element => !element.closest(excluded) && element.querySelector('h1,h2,h3,p') && element.getBoundingClientRect().height > 50)
            .slice(-24);
          const landmarkDeadline = Math.min(deadline - restoreReserve, Date.now() + budget * 0.45);
          for (let index = 0; index < landmarks.length && Date.now() < landmarkDeadline; index++) {
            landmarks[index].scrollIntoView({ block: 'center', behavior: 'instant' });
            const slice = Math.max(0, (landmarkDeadline - Date.now()) / (landmarks.length - index));
            await settleViewport(slice, Math.min(1200, slice * 0.6));
          }
        }
        await sweep();
        // Finish finite animations only; infinite effects and scroll timelines
        // must never make capture wait forever. Visible states above take priority.
        for (const animation of document.getAnimations()) {
          const timing = animation.effect?.getComputedTiming();
          if (timing && Number.isFinite(Number(timing.endTime)) && animation.playState !== 'finished') {
            try { animation.finish(); } catch { /* Unfinishable scroll timeline. */ }
          }
        }
        sampleVisible();
        for (const [root, position] of containerPositions) root.scrollTo({ ...position, behavior: 'instant' });
        window.scrollTo({ top: originalY, left: originalX, behavior: 'instant' });
        // Also catch delayed hero hydration after traversing the rest of the page.
        await settleViewport(
          Math.max(0, deadline - Date.now()),
          Math.max(750, Math.min(8000, budget * 0.6) - (Date.now() - captureStarted))
        );
      } finally {
        observer.disconnect();
        for (const [root, position] of containerPositions) root.scrollTo({ ...position, behavior: 'instant' });
        window.scrollTo({ top: originalY, left: originalX, behavior: 'instant' });
      }
    };
  // tsx/esbuild injects module-local __name helpers into nested callbacks.
  // Evaluate in an explicit browser-local scope, including in development/worker.
  await page.evaluate(`(async () => {
    const __name = (fn) => fn;
    return (${prepare.toString()})(${Math.max(500, timeoutMs)});
  })()`);
}
