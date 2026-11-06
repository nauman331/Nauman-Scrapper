export interface BodyContextInput {
  bodyContext?: { id?: string; className?: string };
  html?: string;
}

export interface SiteBodyContext {
  className?: string;
}

function classTokens(value?: string): string[] {
  return value?.split(/\s+/).map((token) => token.trim()).filter(Boolean) || [];
}

export function deriveSiteBodyContext(pages: BodyContextInput[], css: string): SiteBodyContext {
  if (pages.length === 0) return {};
  const first = classTokens(pages[0].bodyContext?.className);
  const common = first.filter((token) => pages.every((page) => classTokens(page.bodyContext?.className).includes(token)));

  const hasElementorMarkup = pages.some((page) => /\belementor(?:-|\b)/i.test(page.html || ''));
  if (hasElementorMarkup && !common.some((token) => /^elementor-kit-\d+$/i.test(token))) {
    const candidates = new Set<string>();
    for (const match of css.matchAll(/\.((?:elementor-kit-)\d+)\s*\{([^}]*)\}/gi)) {
      if (/--e-global-[\w-]+\s*:/i.test(match[2])) candidates.add(match[1]);
    }
    if (candidates.size === 1) common.push([...candidates][0]);
  }

  return { className: common.length ? [...new Set(common)].join(' ') : undefined };
}

export function removeCommonBodyClasses(
  context: { id?: string; className?: string } | undefined,
  commonClassName?: string
): { id?: string; className?: string } | undefined {
  if (!context) return undefined;
  const common = new Set(classTokens(commonClassName));
  const routeClasses = classTokens(context.className).filter((token) => !common.has(token));
  return { id: context.id, className: routeClasses.length ? routeClasses.join(' ') : undefined };
}
