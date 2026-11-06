import { z } from 'zod';

export const CustomSelectorSchema = z.object({
  name: z.string().min(1, 'Selector name is required'),
  selector: z.string().min(1, 'CSS selector is required'),
  attribute: z.string().optional(), // If provided, extracts attribute (e.g. href, src, data-id)
  multiple: z.boolean().default(false), // If true, extracts array of matches
  transform: z.enum(['text', 'html', 'trim', 'number']).default('trim'),
});

export type CustomSelectorConfig = z.infer<typeof CustomSelectorSchema>;

export const PaginationConfigSchema = z.object({
  nextSelector: z.string().optional(),
  pageParam: z.string().optional(),
  maxPages: z.coerce.number().min(1).max(500).default(10),
});

export type PaginationConfig = z.infer<typeof PaginationConfigSchema>;

export const ExtractionConfigSchema = z.object({
  extractHtml: z.boolean().default(true),
  extractMetadata: z.boolean().default(true),
  extractHeadings: z.boolean().default(true),
  extractMainText: z.boolean().default(true),
  extractLinks: z.boolean().default(true),
  discoverLinks: z.boolean().default(false), // Whether discovered internal links should be added to crawl queue
  specificPageKeywords: z
    .array(
      z
        .string()
        .transform((value) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '))
        .pipe(z.string().min(2).max(64))
    )
    .max(20)
    .refine((keywords) => keywords.reduce((total, keyword) => total + keyword.length, 0) <= 512, {
      message: 'Specific page keywords must total 512 characters or fewer',
    })
    .default([]),
  filterInternalLinksOnly: z.boolean().default(true),
  maxLinksPerPage: z.coerce.number().default(100),
  extractImages: z.boolean().default(false),
  extractJsonLd: z.boolean().default(true),
  customSelectors: z.array(CustomSelectorSchema).default([]),
  pagination: PaginationConfigSchema.optional(),
  requiredFields: z.array(z.string()).default([]), // Fields that must not be null/empty for validation
});

export type ExtractionConfig = z.infer<typeof ExtractionConfigSchema>;

export interface ExtractedImage {
  src: string;
  alt: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ExtractedLink {
  url: string;
  text: string;
  isInternal: boolean;
  rel?: string | null;
}

export interface ExtractedHeadings {
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  h5: string[];
  h6: string[];
}

export interface ExtractedMetadata {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  favicon: string | null;
  language: string | null;
}

export interface ExtractedRedditPost {
  id: string | null;
  title: string;
  url: string | null;
  author: string | null;
  subreddit: string | null;
  score: number | null;
  commentCount: number | null;
  createdAt: string | null;
}

export interface NormalizedPageData {
  url: string;
  metadata: ExtractedMetadata | null;
  headings: ExtractedHeadings | null;
  mainText: string | null;
  links: ExtractedLink[] | null;
  discoveredUrls: string[];
  images: ExtractedImage[] | null;
  jsonLd: unknown[] | null;
  custom: Record<string, unknown> | null;
  redditPosts: ExtractedRedditPost[] | null;
  nextPageUrl: string | null;
  html?: string | null;
}

export interface ExtractionValidationResult {
  passed: boolean;
  errors: string[];
}
