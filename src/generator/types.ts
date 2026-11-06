import { z } from 'zod';

export const ConversionOptionsSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Project name must contain only letters, numbers, hyphens, and underscores')
    .default('nextjs-scraped-site'),
  pages: z.array(z.string().url()).min(1, 'At least one page URL must be selected for conversion'),
  cssStrategy: z.enum(['original', 'tailwind']).default('original'),
  componentExtraction: z.enum(['minimal', 'standard', 'deep']).default('standard'),
  preserveInteractivity: z.boolean().default(true),
  preserveMetadata: z.boolean().default(true),
  typescript: z.boolean().default(true),
});

export type ConversionOptions = z.infer<typeof ConversionOptionsSchema>;

export type ConversionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export type ConversionStageId =
  | 'validate-input'
  | 'load-scrape-snapshot'
  | 'build-page-inventory'
  | 'resolve-assets'
  | 'analyze-page-structure'
  | 'identify-shared-components'
  | 'generate-nextjs-files'
  | 'install-or-resolve-dependencies'
  | 'run-static-validation'
  | 'prepare-preview'
  | 'package-project';

export interface StageProgress {
  id: ConversionStageId;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  message?: string;
}

export interface PageInventoryItem {
  url: string;
  route: string;
  title: string;
  description: string | null;
  canonicalUrl: string | null;
  componentName: string;
  headingsCount: number;
  imagesCount: number;
  linksCount: number;
  hasHeader: boolean;
  hasFooter: boolean;
  hasNav: boolean;
  hasHtml?: boolean;
  htmlBytes?: number;
}

export interface PageInventory {
  jobId: string;
  targetUrl: string;
  domain: string;
  pages: PageInventoryItem[];
  totalPages: number;
  routes: string[];
}

export interface DownloadedAsset {
  originalUrl: string;
  localPath: string; // e.g. 'images/logo.png' relative to public/
  publicUrl: string; // e.g. '/images/logo.png'
  mimeType: string;
  sizeBytes: number;
  hash: string;
  isSvg: boolean;
  isFont: boolean;
  isStylesheet: boolean;
  isImage: boolean;
}

export interface DetectedInteraction {
  type: 'mobile-nav' | 'dropdown' | 'accordion' | 'modal' | 'tabs' | 'carousel' | 'form' | 'unknown';
  selector: string;
  classification: 1 | 2 | 3 | 4; // 1: Fully reproducible, 2: React adaptation, 3: Backend dependent, 4: Unverified
  description: string;
  componentName?: string;
}

export interface SharedComponentDefinition {
  name: string; // e.g. 'Header', 'Footer', 'Navigation'
  category: 'layout' | 'sections' | 'ui';
  filePath: string; // e.g. 'components/layout/Header.tsx'
  jsxCode: string;
  isClientComponent: boolean;
  instancesCount: number;
  usedInRoutes: string[];
  sourceHtml?: string;
}

export interface GeneratedFileNode {
  name: string;
  path: string; // relative to project root
  type: 'file' | 'directory';
  size?: number;
  children?: GeneratedFileNode[];
}

export interface ValidationReport {
  passed: boolean;
  requiredFilesExist: boolean;
  syntaxValid: boolean;
  importReferencesValid: boolean;
  assetReferencesValid: boolean;
  errors: string[];
  warnings: string[];
  checkedFilesCount: number;
  missingAssets: string[];
  brokenInternalRoutes: string[];
}

export interface ConversionRecord {
  id: string;
  jobId: string;
  status: ConversionStatus;
  currentStage: ConversionStageId;
  stages: StageProgress[];
  operationLogs?: Array<{ timestamp: string; stageId: ConversionStageId; status: StageProgress['status']; message: string }>;
  options: ConversionOptions;
  inventory?: PageInventory;
  validationReport?: ValidationReport;
  stylingReport?: {
    strategy: 'original' | 'tailwind';
    declarationsSeen: number;
    declarationsConverted: number;
    declarationsPreserved: number;
    inlineDeclarationsConverted: number;
    residualCssBytes: number;
    warnings: string[];
  };
  fileTree?: GeneratedFileNode;
  totalFilesGenerated: number;
  zipFilePath?: string;
  zipSizeBytes?: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
}
