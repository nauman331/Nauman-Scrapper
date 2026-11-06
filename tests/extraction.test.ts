import { describe, it, expect } from 'vitest';
import { runExtractionPipeline } from '../src/extraction/pipeline.js';
import type { ExtractionConfig } from '../src/extraction/schemas/extraction.schema.js';

describe('Extraction and Normalization Pipeline', () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Sample Tech Article - Daily Dev</title>
      <meta name="description" content="An in-depth guide to modern web scraping architectures." />
      <meta property="og:title" content="OpenGraph Web Scraping Guide" />
      <meta property="og:image" content="https://example.com/images/og-banner.png" />
      <link rel="canonical" href="https://example.com/guide/scraping" />
      <link rel="icon" href="/assets/favicon.ico" />
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Modern Web Scraping",
          "author": { "@type": "Person", "name": "Ada Lovelace" }
        }
      </script>
    </head>
    <body>
      <nav><a href="/home">Home</a><a href="https://twitter.com/dev">Twitter</a></nav>
      <header>
        <h1>Web Scraping Architecture 2026</h1>
        <h2>Scalable and Resilient Pipelines</h2>
      </header>
      <main>
        <p>Web scraping requires durable queueing, robust rate-limiting, and fault tolerance.</p>
        <span class="price-badge">$199.99</span>
        <div class="tags">
          <span class="tag">node</span>
          <span class="tag">crawlee</span>
          <span class="tag">prisma</span>
        </div>
        <img src="/media/diagram.png" alt="Architecture Diagram" width="800" height="600" />
        <a href="/guide/page-2" class="pagination-next">Next Page</a>
      </main>
      <footer><p>&copy; 2026 Example Corp</p></footer>
    </body>
    </html>
  `;

  it('should extract metadata, OpenGraph, and canonical URL', () => {
    const config: ExtractionConfig = {
      extractMetadata: true,
      extractHeadings: false,
      extractMainText: false,
      extractLinks: false,
      discoverLinks: false,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: false,
      customSelectors: [],
      requiredFields: ['title', 'description'],
    };

    const result = runExtractionPipeline(sampleHtml, 'https://example.com/guide/scraping', config);

    expect(result.normalizedData.metadata?.title).toBe('Sample Tech Article - Daily Dev');
    expect(result.normalizedData.metadata?.description).toBe('An in-depth guide to modern web scraping architectures.');
    expect(result.normalizedData.metadata?.canonicalUrl).toBe('https://example.com/guide/scraping');
    expect(result.normalizedData.metadata?.ogTitle).toBe('OpenGraph Web Scraping Guide');
    expect(result.normalizedData.metadata?.ogImage).toBe('https://example.com/images/og-banner.png');
    expect(result.normalizedData.metadata?.favicon).toBe('https://example.com/assets/favicon.ico');
    expect(result.normalizedData.metadata?.language).toBe('en');
    expect(result.validation.passed).toBe(true);
  });

  it('should extract headings and clean main content text without scripts or nav', () => {
    const config: ExtractionConfig = {
      extractMetadata: false,
      extractHeadings: true,
      extractMainText: true,
      extractLinks: false,
      discoverLinks: false,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: false,
      customSelectors: [],
      requiredFields: [],
    };

    const result = runExtractionPipeline(sampleHtml, 'https://example.com/guide/scraping', config);

    expect(result.normalizedData.headings?.h1).toEqual(['Web Scraping Architecture 2026']);
    expect(result.normalizedData.headings?.h2).toEqual(['Scalable and Resilient Pipelines']);
    expect(result.normalizedData.mainText).toContain('Web scraping requires durable queueing');
    expect(result.normalizedData.mainText).not.toContain('&copy;');
  });

  it('should extract custom CSS selectors with type transformations', () => {
    const config: ExtractionConfig = {
      extractMetadata: false,
      extractHeadings: false,
      extractMainText: false,
      extractLinks: false,
      discoverLinks: false,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: false,
      customSelectors: [
        { name: 'price', selector: '.price-badge', multiple: false, transform: 'number' },
        { name: 'tags', selector: '.tag', multiple: true, transform: 'trim' },
        { name: 'missingField', selector: '.non-existent', multiple: false, transform: 'trim' },
      ],
      requiredFields: ['price'],
    };

    const result = runExtractionPipeline(sampleHtml, 'https://example.com/guide/scraping', config);

    expect(result.normalizedData.custom?.price).toBe(199.99);
    expect(result.normalizedData.custom?.tags).toEqual(['node', 'crawlee', 'prisma']);
    expect(result.normalizedData.custom?.missingField).toBeNull();
    expect(result.validation.passed).toBe(true);
  });

  it('should parse JSON-LD structured data', () => {
    const config: ExtractionConfig = {
      extractMetadata: false,
      extractHeadings: false,
      extractMainText: false,
      extractLinks: false,
      discoverLinks: false,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: true,
      customSelectors: [],
      requiredFields: [],
    };

    const result = runExtractionPipeline(sampleHtml, 'https://example.com/guide/scraping', config);

    expect(result.normalizedData.jsonLd).toHaveLength(1);
    const jsonLd = result.normalizedData.jsonLd?.[0] as Record<string, unknown>;
    expect(jsonLd?.headline).toBe('Modern Web Scraping');
  });

  it('should discover pagination link with CSS selector', () => {
    const config: ExtractionConfig = {
      extractMetadata: false,
      extractHeadings: false,
      extractMainText: false,
      extractLinks: false,
      discoverLinks: true,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: false,
      customSelectors: [],
      pagination: { nextSelector: '.pagination-next', maxPages: 5 },
      requiredFields: [],
    };

    const result = runExtractionPipeline(sampleHtml, 'https://example.com/guide/scraping', config);

    expect(result.normalizedData.nextPageUrl).toBe('https://example.com/guide/page-2');
    expect(result.discoveredUrls).toContain('https://example.com/guide/page-2');
  });

  it('should extract structured Reddit posts from shreddit custom elements', () => {
    const redditHtml = `
      <html><body><main>
        <shreddit-post
          id="t3_example"
          post-title="Girls please help me out.."
          permalink="/r/TwoXChromosomes/comments/example/girls_please_help_me_out/"
          author="example_user"
          subreddit-prefixed-name="r/TwoXChromosomes"
          score="42"
          comment-count="7"
        ></shreddit-post>
      </main></body></html>
    `;
    const config: ExtractionConfig = {
      extractMetadata: false,
      extractHeadings: true,
      extractMainText: true,
      extractLinks: false,
      discoverLinks: false,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: false,
      customSelectors: [],
      requiredFields: [],
    };

    const result = runExtractionPipeline(
      redditHtml,
      'https://www.reddit.com/r/TwoXChromosomes/',
      config
    );

    expect(result.normalizedData.redditPosts).toEqual([
      expect.objectContaining({
        title: 'Girls please help me out..',
        url: 'https://www.reddit.com/r/TwoXChromosomes/comments/example/girls_please_help_me_out',
        author: 'example_user',
        score: 42,
        commentCount: 7,
      }),
    ]);
  });

  it('should fail validation when a required field is missing', () => {
    const config: ExtractionConfig = {
      extractMetadata: true,
      extractHeadings: false,
      extractMainText: false,
      extractLinks: false,
      discoverLinks: false,
      filterInternalLinksOnly: true,
      maxLinksPerPage: 10,
      extractImages: false,
      extractJsonLd: false,
      customSelectors: [
        { name: 'mandatoryRating', selector: '.rating', multiple: false, transform: 'trim' },
      ],
      requiredFields: ['mandatoryRating'],
    };

    const result = runExtractionPipeline(sampleHtml, 'https://example.com/guide/scraping', config);

    expect(result.validation.passed).toBe(false);
    expect(result.validation.errors).toContain('Missing required custom selector: mandatoryRating');
  });

  it('filters discovered links by normalized literal pathname or anchor text', () => {
    const html = `<a href="/company/about-us">Company</a><a href="/support">Contact Us</a><a href="/news">News</a><a href="https://external.test/about-us">External</a>`;
    const config = { extractMetadata: false, extractHeadings: false, extractMainText: false, extractLinks: true, discoverLinks: true, specificPageKeywords: ['about us', 'contact us'], filterInternalLinksOnly: false, maxLinksPerPage: 20, extractImages: false, extractJsonLd: false, customSelectors: [], requiredFields: [] } satisfies ExtractionConfig;
    const result = runExtractionPipeline(html, 'https://example.com/', config);
    expect(result.discoveredUrls).toEqual(['https://example.com/company/about-us', 'https://example.com/support']);
    expect(result.normalizedData.links).toHaveLength(4);
  });

  it('treats punctuation as literal normalized text, never regex syntax', () => {
    const html = `<a href="/pricing/a-b">A+B plans</a><a href="/pricing/anything">Anything</a>`;
    const config = { extractMetadata: false, extractHeadings: false, extractMainText: false, extractLinks: true, discoverLinks: true, specificPageKeywords: ['a+b'], filterInternalLinksOnly: true, maxLinksPerPage: 20, extractImages: false, extractJsonLd: false, customSelectors: [], requiredFields: [] } satisfies ExtractionConfig;
    expect(runExtractionPipeline(html, 'https://example.com/', config).discoveredUrls).toEqual(['https://example.com/pricing/a-b']);
  });

  it('handles malformed percent encoding safely', () => {
    const html = `<a href="/about-%E0%A4%A-us">About</a>`;
    const config = { extractMetadata: false, extractHeadings: false, extractMainText: false, extractLinks: true, discoverLinks: true, specificPageKeywords: ['about'], filterInternalLinksOnly: true, maxLinksPerPage: 20, extractImages: false, extractJsonLd: false, customSelectors: [], requiredFields: [] } satisfies ExtractionConfig;
    expect(() => runExtractionPipeline(html, 'https://example.com/', config)).not.toThrow();
  });

  it('applies keyword and discoverLinks rules to pagination', () => {
    const html = `<a class="next" href="/news/page-2">Next</a>`;
    const base = { extractMetadata: false, extractHeadings: false, extractMainText: false, extractLinks: true, filterInternalLinksOnly: true, maxLinksPerPage: 20, extractImages: false, extractJsonLd: false, customSelectors: [], pagination: { nextSelector: '.next', maxPages: 5 }, requiredFields: [] };
    expect(runExtractionPipeline(html, 'https://example.com/news', { ...base, discoverLinks: true, specificPageKeywords: ['about us'] }).discoveredUrls).toEqual([]);
    expect(runExtractionPipeline(html, 'https://example.com/news', { ...base, discoverLinks: false, specificPageKeywords: [] }).discoveredUrls).toEqual([]);
    expect(runExtractionPipeline(html, 'https://example.com/news', { ...base, discoverLinks: true, specificPageKeywords: [] }).discoveredUrls).toEqual(['https://example.com/news/page-2']);
  });

});
