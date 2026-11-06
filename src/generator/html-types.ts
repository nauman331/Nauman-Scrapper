import { z } from 'zod';
import { ConversionOptionsSchema, type ConversionStatus, type GeneratedFileNode, type PageInventory, type ValidationReport } from './types.js';
import type { TailwindConversionResult } from './analyzer/tailwind-converter.js';

export const HtmlConversionOptionsSchema = ConversionOptionsSchema.omit({ pages: true, cssStrategy: true, typescript: true, componentExtraction: true }).extend({
  projectName: ConversionOptionsSchema.shape.projectName.default('html-scraped-site'),
  pages: z.array(z.string().url()).min(1).max(500).optional(),
  snapshotJobIds: z.array(z.string().min(1).max(128)).min(1).max(500).optional(), // Workflow-only: combine ordinary single-page scrape snapshots
  cloneMode: z.enum(['single', 'full']).default('single'),
  cssStrategy: z.enum(['tailwind', 'core']).default('tailwind'),
  preserveInteractivity: z.boolean().default(false),
  useProxy: z.boolean().default(false),
  proxyId: z.string().cuid().optional(),
  // Accepted for API compatibility; HTML output never emits components or TypeScript.
  componentExtraction: z.enum(['minimal', 'standard', 'deep']).default('minimal'),
  typescript: z.literal(false).default(false),
}).superRefine((options, context) => {
  if (options.useProxy && !options.proxyId) context.addIssue({ code: 'custom', path: ['proxyId'], message: 'Select a saved proxy when proxy routing is enabled.' });
});
export type HtmlConversionOptions = z.infer<typeof HtmlConversionOptionsSchema>;
export type HtmlStageId = 'validate-input' | 'load-scrape-snapshot' | 'build-page-inventory' | 'resolve-assets' | 'generate-html-files' | 'compile-tailwind' | 'prepare-preview' | 'package-project';
export interface HtmlConversionRecord {
  id: string;
  jobId: string;
  format: 'html';
  status: ConversionStatus;
  currentStage: HtmlStageId;
  stages: Array<{ id: HtmlStageId; label: string; status: 'pending' | 'running' | 'completed' | 'failed'; message?: string; startedAt?: string; finishedAt?: string }>;
  options: HtmlConversionOptions;
  warnings: string[];
  conversionStats?: TailwindConversionResult['stats'];
  svgStats?: { detected: number; optimized: number; extracted: number; keptInline: number; reused: number; assetsCreated: number };
  pageFiles?: Array<{ url: string; path: string; cssPath: string }>;
  inventory?: PageInventory;
  validationReport?: ValidationReport;
  fileTree?: GeneratedFileNode;
  totalFilesGenerated: number;
  zipFilePath?: string;
  zipSizeBytes?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}
