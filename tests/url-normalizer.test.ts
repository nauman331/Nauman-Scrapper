import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  hashUrl,
  extractDomain,
  isInternalLink,
} from '../src/core/domain/url-normalizer.js';

describe('URL Normalizer and Domain Tools', () => {
  it('should strip tracking parameters and sort query parameters', () => {
    const raw =
      'https://example.com/products/item?utm_source=twitter&category=books&utm_campaign=summer&sort=asc#reviews';
    const normalized = normalizeUrl(raw);

    expect(normalized).toBe('https://example.com/products/item?category=books&sort=asc');
  });

  it('should remove trailing slashes from paths while preserving root slash', () => {
    expect(normalizeUrl('https://example.com/blog/article/')).toBe('https://example.com/blog/article');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('should resolve relative URLs against base URL', () => {
    const base = 'https://example.com/news/tech/';
    expect(normalizeUrl('/about', base)).toBe('https://example.com/about');
    expect(normalizeUrl('article-123.html', base)).toBe('https://example.com/news/tech/article-123.html');
  });

  it('should produce identical sha256 hashes for equivalent URLs', () => {
    const url1 = 'https://example.com/page?b=2&a=1&utm_medium=email#frag';
    const url2 = 'https://example.com/page?a=1&b=2';

    const hash1 = hashUrl(url1);
    const hash2 = hashUrl(url2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should extract root domain', () => {
    expect(extractDomain('https://sub.domain.co.uk/path')).toBe('sub.domain.co.uk');
    expect(extractDomain('https://example.com:8080/')).toBe('example.com');
  });

  it('should correctly classify internal vs external links', () => {
    const baseDomain = 'example.com';

    expect(isInternalLink('https://example.com/docs', baseDomain)).toBe(true);
    expect(isInternalLink('https://blog.example.com/article', baseDomain)).toBe(true);
    expect(isInternalLink('https://www.example.com/page', baseDomain)).toBe(true);

    expect(isInternalLink('https://google.com', baseDomain)).toBe(false);
    expect(isInternalLink('https://example.org', baseDomain)).toBe(false);
    expect(isInternalLink('https://attacker-example.com', baseDomain)).toBe(false);
  });
});
