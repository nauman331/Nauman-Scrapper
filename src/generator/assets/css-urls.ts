/** Matches whole URLs, including accidentally backslash-quoted SVG data URLs. */
export const cssUrlPattern = () => /url\(\s*((?:\\"(?:\\.|[^\\])*?\\"|\\'(?:\\.|[^\\])*?\\'|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)'"\s][^)]*?))\s*\)/gi;

/** Normalize URL wrappers before URL resolution without decoding a data payload. */
export function unquoteCssUrl(raw: string): string {
  let value = raw.trim().replace(/&quot;|&#34;|&#x22;|&apos;|&#39;|&#x27;/gi, entity => /quot|34|22/i.test(entity) ? '"' : "'");
  for (let pass = 0; pass < 4; pass++) {
    const previous = value;
    // Some callers have already resolved a quoted data URL against an HTTP base.
    // Recover only an explicitly quoted data scheme, never an ordinary HTTP asset.
    const embedded = value.match(/^https?:\/\/[^/]+\/[\s\S]*?(?:\\?["']|%(?:25)*(?:22|27))(data:image[\s\S]*)$/i);
    if (embedded) value = embedded[1].replace(/(?:\\?["']|%(?:25)*(?:22|27))$/i, '');
    value = value.replace(/^\\(["'])/, '$1').replace(/\\(["'])$/, '$1').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1).trim();
    const encodedQuote = value.match(/^(%22|%27)([\s\S]*)\1$/i);
    if (encodedQuote) value = encodedQuote[2].trim();
    if (/^(?:data:|blob:|#)/i.test(value)) return value;
    // Decode URL wrappers incrementally; once data: is visible its payload stays intact.
    if (/^(?:%64ata|data%3a|%[0-9a-f]{2})/i.test(value)) {
      try { value = decodeURIComponent(value); } catch { /* retain malformed escapes */ }
    }
    if (value === previous) break;
  }
  return value;
}

/** Quote recovered data URLs without breaking SVG quotes or literal newlines. */
export function cssDataUrl(value: string): string {
  return `url("${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}")`;
}
