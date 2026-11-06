import * as cheerio from 'cheerio';
import type { NormalizedPageData } from './schemas/extraction.schema.js';

export interface CleanDataPage { url: string; rawData: NormalizedPageData }
export interface CleanData {
  landingPageUrl: string;
  title: string | null;
  description: string | null;
  meta: { canonicalUrl: string | null; language: string | null; ogTitle: string | null; ogDescription: string | null };
  author: string | null;
  logoUrl: string | null;
  emails: string[];
  phoneNumbers: string[];
  socialUrls: string[];
  contactPageUrls: string[];
  aboutPageUrls: string[];
  addresses: string[];
  pagesAnalyzed: number;
}

type JsonRecord = Record<string, unknown>;
const SOCIAL_HOSTS = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|tiktok\.com|github\.com|pinterest\.(com|[a-z]{2})|threads\.net|mastodon\.social)$/i;
const SHARE_PATH = /\/(share|sharing|intent|sharer|dialog|compose|login|watch)(\/|$)/i;
const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

function record(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function values(value: unknown): unknown[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function add(set: Set<string>, value: string | null): void { if (value) set.add(value); }
function absolute(value: unknown, base: string): string | null { try { const v = text(value); return v ? new URL(v, base).toString() : null; } catch { return null; } }
function normalizedComparable(url: string): string { try { const u = new URL(url); u.hash = ''; if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, ''); return u.toString(); } catch { return url; } }
function withoutFragment(url: string): string { try { const u = new URL(url); u.hash = ''; return u.toString(); } catch { return url; } }
function safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function addEmail(set: Set<string>, candidate: unknown): void {
  const raw = text(candidate); if (!raw) return;
  const email = safeDecode(raw.replace(/^mailto:/i, '').split('?')[0] ?? '').trim().toLowerCase();
  if (EMAIL.test(email)) set.add(email);
}
function addPhone(set: Set<string>, candidate: unknown): void {
  const raw = text(candidate)?.replace(/^tel:/i, '').split('?')[0]?.trim();
  if (raw && raw.replace(/\D/g, '').length >= 7) set.add(safeDecode(raw));
}
function socialUrl(candidate: unknown, base: string): string | null {
  const resolved = absolute(candidate, base); if (!resolved) return null;
  try { const u = new URL(resolved); const host = u.hostname.replace(/^www\./i, ''); if (!SOCIAL_HOSTS.test(host) || SHARE_PATH.test(u.pathname)) return null; const pieces = u.pathname.split('/').filter(Boolean); if (!pieces.length) return null; u.hash = ''; return u.toString(); } catch { return null; }
}
function addressText(value: unknown): string | null {
  if (typeof value === 'string') return text(value);
  if (!record(value)) return null;
  return ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'].map(k => text(value[k])).filter(Boolean).join(', ') || null;
}
function typeNames(value: unknown): string[] { return values(value).map(text).filter((v): v is string => Boolean(v)).map(v => v.toLowerCase()); }
function walkJson(value: unknown, visit: (node: JsonRecord) => void): void {
  if (Array.isArray(value)) { value.forEach(item => walkJson(item, visit)); return; }
  if (!record(value)) return;
  visit(value);
  Object.values(value).forEach(child => walkJson(child, visit));
}
function logoFrom(value: unknown, base: string): string | null {
  if (typeof value === 'string') return absolute(value, base);
  if (record(value)) return absolute(value.url ?? value.contentUrl, base);
  return null;
}
function pageKind(url: string, label = ''): 'contact' | 'about' | null {
  const haystack = `${new URL(url).pathname} ${label}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\b(contact|support|get in touch|customer service)\b/.test(haystack)) return 'contact';
  if (/\b(about|our story|who we are|company)\b/.test(haystack)) return 'about';
  return null;
}

export function aggregateCleanData(pages: CleanDataPage[], targetUrl: string): CleanData {
  const landingPageUrl = targetUrl;
  const landingComparable = normalizedComparable(targetUrl);
  const landing = pages.find(page => normalizedComparable(page.url) === landingComparable || normalizedComparable(page.rawData.url) === landingComparable);
  const preferred = landing?.rawData ?? pages[0]?.rawData;
  const emails = new Set<string>(), phones = new Set<string>(), socials = new Set<string>(), contacts = new Set<string>(), about = new Set<string>(), addresses = new Set<string>();
  let author: string | null = null, structuredLogo: string | null = null, htmlLogo: string | null = null, iconLogo: string | null = null, ogLogo: string | null = null;

  for (const page of pages) {
    const data = page.rawData; const base = page.url || data.url;
    const kind = pageKind(base); if (kind === 'contact') contacts.add(withoutFragment(base)); if (kind === 'about') about.add(withoutFragment(base));
    for (const root of data.jsonLd ?? []) walkJson(root, node => {
      const types = typeNames(node['@type']);
      if (!author) { for (const a of values(node.author)) { if (typeof a === 'string') author = text(a); else if (record(a)) author = text(a.name); if (author) break; } }
      addEmail(emails, node.email); addPhone(phones, node.telephone);
      for (const cp of values(node.contactPoint)) if (record(cp)) { addEmail(emails, cp.email); addPhone(phones, cp.telephone); }
      for (const a of values(node.address)) add(addresses, addressText(a));
      for (const same of values(node.sameAs)) add(socials, socialUrl(same, base));
      if (!structuredLogo && types.some(t => t === 'organization' || t.endsWith('business'))) structuredLogo = logoFrom(node.logo, base);
    });
    if (data.html) {
      const $ = cheerio.load(data.html);
      if (!author) author = text($('meta[name="author"], meta[property="article:author"]').first().attr('content'));
      $('a[href^="mailto:"]').each((_, el) => addEmail(emails, $(el).attr('href')));
      $('a[href^="tel:"]').each((_, el) => addPhone(phones, $(el).attr('href')));
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href'); const resolved = absolute(href, base); if (!resolved) return;
        add(socials, socialUrl(href, base));
        try { if (new URL(resolved).origin === new URL(base).origin) { const k = pageKind(resolved, $(el).text()); if (k === 'contact') contacts.add(withoutFragment(resolved)); if (k === 'about') about.add(withoutFragment(resolved)); } } catch { /* ignored */ }
      });
      const visible = $('body').clone(); visible.find('script,style,noscript,a[href^="mailto:"],a[href^="tel:"]').remove();
      const emailContexts = kind
        ? visible
        : visible.find('footer,address,[id],[class],[aria-label]').filter((_, el) => {
          if (el.type !== 'tag') return false;
          if (el.name === 'footer' || el.name === 'address') return true;
          const hint = `${$(el).attr('id') ?? ''} ${$(el).attr('class') ?? ''} ${$(el).attr('aria-label') ?? ''}`;
          return /(contact|support|footer)/i.test(hint);
        });
      const seenEmailTextNodes = new Set<object>();
      emailContexts.find('*').addBack().contents().each((_, node) => {
        if (node.type !== 'text' || seenEmailTextNodes.has(node)) return;
        seenEmailTextNodes.add(node);
        for (const match of (node.data ?? '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) addEmail(emails, match);
      });
      $('img[src], link[href]').each((_, el) => { const hint = `${$(el).attr('alt') ?? ''} ${$(el).attr('class') ?? ''} ${$(el).attr('id') ?? ''} ${$(el).attr('rel') ?? ''}`; if (!htmlLogo && /\b(logo|brand)\b/i.test(hint)) htmlLogo = absolute($(el).attr('src') ?? $(el).attr('href'), base); });
      iconLogo ||= absolute($('link[rel~="icon"], link[rel="shortcut icon"]').first().attr('href'), base);
    }
    ogLogo ||= absolute(data.metadata?.ogImage, base);
  }
  const meta = preferred?.metadata;
  return { landingPageUrl, title: meta?.title ?? null, description: meta?.description ?? null, meta: { canonicalUrl: meta?.canonicalUrl ?? null, language: meta?.language ?? null, ogTitle: meta?.ogTitle ?? null, ogDescription: meta?.ogDescription ?? null }, author, logoUrl: structuredLogo ?? htmlLogo ?? iconLogo ?? ogLogo, emails: [...emails], phoneNumbers: [...phones], socialUrls: [...socials], contactPageUrls: [...contacts], aboutPageUrls: [...about], addresses: [...addresses], pagesAnalyzed: pages.length };
}
