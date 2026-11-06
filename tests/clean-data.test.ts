import { describe, expect, it } from 'vitest';
import { aggregateCleanData } from '../src/extraction/clean-data.js';
import type { NormalizedPageData } from '../src/extraction/schemas/extraction.schema.js';

function page(url: string, values: Partial<NormalizedPageData> = {}) {
  return { url, rawData: { url, metadata: null, headings: null, mainText: null, links: null, discoveredUrls: [], images: null, jsonLd: null, custom: null, redditPosts: null, nextPageUrl: null, html: null, ...values } };
}

describe('aggregateCleanData', () => {
  it('explicitly selects the target landing page for metadata regardless of result order', () => {
    const result = aggregateCleanData([
      page('https://example.com/about', { metadata: { title: 'About', description: 'Wrong', canonicalUrl: null, ogTitle: null, ogDescription: null, ogImage: null, twitterTitle: null, twitterDescription: null, favicon: null, language: null } }),
      page('https://example.com/', { metadata: { title: 'Landing', description: 'Preferred', canonicalUrl: 'https://example.com/', ogTitle: 'OG', ogDescription: 'OG desc', ogImage: null, twitterTitle: null, twitterDescription: null, favicon: null, language: 'en' } })
    ], 'https://example.com/');
    expect(result.title).toBe('Landing'); expect(result.description).toBe('Preferred'); expect(result.landingPageUrl).toBe('https://example.com/');
  });

  it('recursively extracts nested JSON-LD organization details', () => {
    const result = aggregateCleanData([page('https://example.com/', { jsonLd: [{ '@graph': [{ '@type': 'Organization', logo: '/logo.svg', sameAs: ['https://github.com/acme', 'https://twitter.com/intent/tweet'], contactPoint: { email: 'HELLO@example.com', telephone: '+1 555 123 4567' }, address: { streetAddress: '1 Main St', addressLocality: 'Town' } }] }] })], 'https://example.com/');
    expect(result.logoUrl).toBe('https://example.com/logo.svg'); expect(result.emails).toEqual(['hello@example.com']); expect(result.socialUrls).toEqual(['https://github.com/acme']); expect(result.phoneNumbers).toEqual(['+1 555 123 4567']); expect(result.addresses).toEqual(['1 Main St, Town']);
  });

  it('extracts HTML contacts, author, relative logo and deduplicates values', () => {
    const html = `<meta name="author" content="Ada"><a href="mailto:Info%40Example.com?subject=Hi">mail</a><footer>info@example.com <a href="tel:+44-20-1234-5678">Call</a><a href="https://www.instagram.com/acme/">Instagram</a><a href="/contact">Contact us</a><img class="site-logo" src="/brand.png"></footer>`;
    const result = aggregateCleanData([page('https://example.com/', { html })], 'https://example.com/');
    expect(result.author).toBe('Ada'); expect(result.emails).toEqual(['info@example.com']); expect(result.logoUrl).toBe('https://example.com/brand.png'); expect(result.contactPageUrls).toEqual(['https://example.com/contact']); expect(result.socialUrls).toEqual(['https://www.instagram.com/acme/']);
  });

  it('restricts landing-page visible emails to credible contact contexts without duplicate matches', () => {
    const html = `<main><div class="demo">deniz@acme.com emre@acme.com melda@acme.com can@acme.com</div></main><footer><section class="contact-support">real@example.com</section></footer>`;
    const result = aggregateCleanData([page('https://example.com/', { html })], 'https://example.com/');
    expect(result.emails).toEqual(['real@example.com']);
  });

  it('extracts visible emails across contact pages while preserving per-text-node matching', () => {
    const html = '<div>seatsdeniz@acme.com</div><div>membersend</div><p>support@example.com</p>';
    const result = aggregateCleanData([page('https://example.com/contact', { html })], 'https://example.com/');
    expect(result.emails).toEqual(['seatsdeniz@acme.com', 'support@example.com']);
  });

  it('removes fragments when deduplicating contact and about page URLs', () => {
    const html = '<a href="/enterprise#contact">Contact</a><a href="/enterprise">Contact</a><a href="/company#about">About</a>';
    const result = aggregateCleanData([page('https://example.com/', { html })], 'https://example.com/');
    expect(result.contactPageUrls).toEqual(['https://example.com/enterprise']);
    expect(result.aboutPageUrls).toEqual(['https://example.com/company']);
  });

  it('keeps author and logo nullable and never exposes HTML', () => {
    const result = aggregateCleanData([page('https://example.com/')], 'https://example.com/');
    expect(result.author).toBeNull(); expect(result.logoUrl).toBeNull(); expect(result).not.toHaveProperty('html'); expect(result.pagesAnalyzed).toBe(1);
  });
});
