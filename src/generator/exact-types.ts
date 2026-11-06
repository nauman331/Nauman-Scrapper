import { z } from 'zod';
import { ConversionOptionsSchema, type ConversionStatus, type GeneratedFileNode, type PageInventory, type ValidationReport } from './types.js';
import type { TailwindConversionResult } from './analyzer/tailwind-converter.js';

export const ExactConversionOptionsSchema = ConversionOptionsSchema.omit({ pages: true, cssStrategy: true, typescript: true, componentExtraction: true }).extend({
  projectName: ConversionOptionsSchema.shape.projectName.default('exact-scraped-site'),
  pages: z.array(z.string().url()).min(1).max(500).optional(),
  snapshotJobIds: z.array(z.string().min(1).max(128)).min(1).max(500).optional(),
  cloneMode: z.enum(['single', 'full']).default('single'),
  preservationMode: z.literal('exact').default('exact'),
  cssStrategy: z.never().optional(),
  preserveInteractivity: z.boolean().default(false),
});
export type ExactConversionOptions = z.infer<typeof ExactConversionOptionsSchema>;
export type ExactStageId = 'validate-input' | 'load-scrape-snapshot' | 'build-page-inventory' | 'resolve-assets' | 'generate-html-files' | 'preserve-source-css' | 'prepare-preview' | 'package-project';
export interface ExactConversionRecord {
  id: string;
  jobId: string;
  format: 'html';
  exportMode: 'exact';
  status: ConversionStatus;
  currentStage: ExactStageId;
  stages: Array<{ id: ExactStageId; label: string; status: 'pending' | 'running' | 'completed' | 'failed'; message?: string; startedAt?: string; finishedAt?: string }>;
  options: ExactConversionOptions;
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
