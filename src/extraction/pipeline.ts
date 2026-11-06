import * as cheerio from 'cheerio';
import type {
  ExtractionConfig,
  NormalizedPageData,
  ExtractionValidationResult,
} from './schemas/extraction.schema.js';
import { extractMetadata } from './extractors/metadata.extractor.js';
import { extractHeadings, extractMainText } from './extractors/content.extractor.js';
import { extractLinks, matchesSpecificPageKeywords } from './extractors/link.extractor.js';
import { extractImages } from './extractors/image.extractor.js';
import { extractJsonLd } from './extractors/jsonld.extractor.js';
import { extractCustomSelectors } from './extractors/selector.extractor.js';
import { extractNextPageUrl } from './pagination.js';
import { extractDomain, isInternalLink, normalizeUrl } from '../core/domain/url-normalizer.js';
import { extractRedditPosts, isRedditUrl } from './extractors/reddit.extractor.js';

export interface ExtractionPipelineResult {
  url: string;
  normalizedData: NormalizedPageData;
  validation: ExtractionValidationResult;
  discoveredUrls: string[];
}

export function runExtractionPipeline(
  html: string,
  url: string,
  config: ExtractionConfig
): ExtractionPipelineResult {
  const normalizedUrl = normalizeUrl(url);
  const $ = cheerio.load(html);

  // 1. Metadata
  const metadata = config.extractMetadata ? extractMetadata($, normalizedUrl) : null;

  // 2. Headings
  const headings = config.extractHeadings ? extractHeadings($) : null;

  // 3. Main Text
  const mainText = config.extractMainText ? extractMainText($) : null;

  // 4. Links & Link Discovery
  let links = null;
  let discoveredUrls: string[] = [];
  if (config.extractLinks) {
    const linkResult = extractLinks($, normalizedUrl, {
      maxLinks: config.maxLinksPerPage,
      filterInternalOnly: config.filterInternalLinksOnly,
      discoverLinks: config.discoverLinks,
      specificPageKeywords: config.specificPageKeywords,
    });
    links = linkResult.links;
    discoveredUrls = linkResult.discoveredUrls;
  }

  // 5. Images
  const images = config.extractImages ? extractImages($, normalizedUrl) : null;

  // 6. JSON-LD
  const jsonLd = config.extractJsonLd ? extractJsonLd($) : null;

  // 7. Custom Selectors
  const custom =
    config.customSelectors && config.customSelectors.length > 0
      ? extractCustomSelectors($, config.customSelectors)
      : null;

  // 8. Site-aware structured extraction. Reddit renders feed entries as custom
  // shreddit-post elements, so generic h1/h2 extraction does not expose post titles.
  const redditPosts = isRedditUrl(normalizedUrl) ? extractRedditPosts($, normalizedUrl) : null;

  // 9. Pagination
  const nextPageUrl = extractNextPageUrl($, normalizedUrl, config.pagination);
  if (
    nextPageUrl &&
    config.discoverLinks &&
    ((config.specificPageKeywords?.length ?? 0) === 0 ||
      isInternalLink(nextPageUrl, extractDomain(normalizedUrl))) &&
    matchesSpecificPageKeywords(nextPageUrl, '', config.specificPageKeywords ?? []) &&
    !discoveredUrls.includes(nextPageUrl)
  ) {
    discoveredUrls.push(nextPageUrl);
  }

  const normalizedData: NormalizedPageData = {
    url: normalizedUrl,
    metadata,
    headings,
    mainText,
    links,
    discoveredUrls,
    images,
    jsonLd,
    custom,
    redditPosts,
    nextPageUrl,
    html: config.extractHtml !== false ? html : null,
  };

  // 10. Validation
  const validation = validateExtractedData(normalizedData, config.requiredFields);

  return {
    url: normalizedUrl,
    normalizedData,
    validation,
    discoveredUrls,
  };
}

function validateExtractedData(
  data: NormalizedPageData,
  requiredFields: string[] = []
): ExtractionValidationResult {
  const errors: string[] = [];

  for (const field of requiredFields || []) {
    if (field === 'title' && (!data.metadata?.title || data.metadata.title.trim() === '')) {
      errors.push('Missing required field: title');
    } else if (field === 'description' && (!data.metadata?.description || data.metadata.description.trim() === '')) {
      errors.push('Missing required field: description');
    } else if (field === 'mainText' && (!data.mainText || data.mainText.trim() === '')) {
      errors.push('Missing required field: mainText');
    } else if (data.custom && field in data.custom) {
      const val = data.custom[field];
      if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
        errors.push(`Missing required custom selector: ${field}`);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}
