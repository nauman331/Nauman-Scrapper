/** Matches a whole quoted URL, including parentheses inside SVG data or filenames. */
export const cssUrlPattern = () => /url\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)'"\s][^)]*?))\s*\)/gi;
export function unquoteCssUrl(raw: string): string {
  const value = raw.trim();
  return /^(?:"[\s\S]*"|'[\s\S]*')$/.test(value) ? value.slice(1, -1) : value;
}
