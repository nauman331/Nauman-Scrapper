import { expect, it, vi } from 'vitest';
import { exportStandaloneHtml } from '../src/generator/html-exporter.js';
import { HtmlConversionOptionsSchema } from '../src/generator/html-types.js';
import { conversionStorage } from '../src/generator/storage.js';

vi.mock('../src/generator/assets/asset-downloader.js', () => ({ assetDownloader: {
 resolveAssets: async () => ({ downloadedAssets: [], missingAssets: [], consolidatedCss: '' }),
} }));
vi.mock('../src/generator/analyzer/tailwind-converter.js', () => ({ convertDocumentsToTailwind: (documents: unknown[]) => ({
 documents, residualCss: '', utilities: [],
 warnings: Array.from({ length: 200000 }, () => ({ message: 'Repeated unsupported source declaration' })),
 stats: { declarationsSeen: 0, declarationsConverted: 0, declarationsPreserved: 0, inlineDeclarationsConverted: 0, sourceClassesRemoved: 0 },
}) }));

it('exports large warning collections without exceeding the JavaScript argument limit', async () => {
 const id='html_large_warning_test';
 try {
  await conversionStorage.setupConversionWorkspace(id);
  const result=await exportStandaloneHtml({ conversionId:id,jobId:'job',targetUrl:'https://site.test/',domain:'site.test',pages:[{url:'https://site.test/',rawData:{html:'<html><head></head><body><p>Content</p></body></html>'}}],options:HtmlConversionOptionsSchema.parse({cssStrategy:'tailwind'}) });
  expect(result.warnings).toContain('Repeated unsupported source declaration');
  expect(result.warnings.filter(w=>w==='Repeated unsupported source declaration')).toHaveLength(1);
 }finally{await conversionStorage.deleteConversion(id);}
});
