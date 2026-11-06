import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConversionService } from '../src/generator/conversion.service.js';
import { jobRepository } from '../src/persistence/repositories/job.repository.js';
import { resultRepository } from '../src/persistence/repositories/result.repository.js';
import { conversionStorage } from '../src/generator/storage.js';
import { staticValidator } from '../src/generator/validator/static-validator.js';
import { zipPackager } from '../src/generator/packager/zip-packager.js';
import { ConversionOptionsSchema } from '../src/generator/types.js';

const job = { id: 'snapshot-job', targetUrl: 'https://example.com/', domain: 'example.com', name: 'Snapshot' };
const page = { url: 'https://example.com/', rawData: { html: '<html><body><section><h1>Saved snapshot</h1></section></body></html>' } };

async function awaitTerminal(service: ConversionService, id: string) {
  await vi.waitFor(() => expect(['FAILED', 'COMPLETED']).toContain(service.getConversion(id)?.status));
  return service.getConversion(id)!;
}

afterEach(() => vi.restoreAllMocks());

describe('Conversion snapshot loading and packaging gates', () => {
  it('loads every page batch for preview, including pages after the first 200', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue(job as never);
    vi.spyOn(resultRepository, 'getResultsByJobId').mockImplementation(async (_id, options) => {
      const offset = options?.offset || 0;
      const items = Array.from({ length: offset === 0 ? 200 : 5 }, (_, index) => ({ ...page, url: `https://example.com/page-${offset + index}` }));
      return { items, total: 205, limit: 200, offset } as never;
    });
    const preview = await new ConversionService().getJobPreview(job.id);
    expect(preview.pages).toHaveLength(205);
    expect(preview.pages[204].hasHtml).toBe(true);
    expect(preview.pages[204].htmlBytes).toBeGreaterThan(0);
  });

  it('does not package missing saved HTML as placeholder content', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue(job as never);
    vi.spyOn(resultRepository, 'getResultsByJobId').mockResolvedValue({ items: [{ url: page.url, rawData: {} }], total: 1 } as never);
    vi.spyOn(conversionStorage, 'setupConversionWorkspace').mockResolvedValue(undefined);
    const packageSpy = vi.spyOn(zipPackager, 'packageProject');
    const service = new ConversionService();
    const record = await service.startConversion(job.id, ConversionOptionsSchema.parse({ pages: [page.url] }));
    const terminal = await awaitTerminal(service, record.id);
    expect(terminal.status).toBe('FAILED');
    expect(terminal.errorMessage).toContain('without saved HTML');
    expect(packageSpy).not.toHaveBeenCalled();
  });

  it('blocks ZIP packaging when generated project validation fails', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue(job as never);
    vi.spyOn(resultRepository, 'getResultsByJobId').mockResolvedValue({ items: [page], total: 1 } as never);
    vi.spyOn(conversionStorage, 'setupConversionWorkspace').mockResolvedValue(undefined);
    vi.spyOn(conversionStorage, 'writeFileSafe').mockResolvedValue(undefined);
    vi.spyOn(staticValidator, 'validateProject').mockResolvedValue({
      passed: false, requiredFilesExist: true, syntaxValid: true, importReferencesValid: true,
      assetReferencesValid: true, errors: ['CSS syntax error'], warnings: [], checkedFilesCount: 2,
      missingAssets: [], brokenInternalRoutes: [],
    });
    const packageSpy = vi.spyOn(zipPackager, 'packageProject');
    const service = new ConversionService();
    const record = await service.startConversion(job.id, ConversionOptionsSchema.parse({ pages: [page.url] }));
    const terminal = await awaitTerminal(service, record.id);
    expect(terminal.status).toBe('FAILED');
    expect(terminal.errorMessage).toContain('ZIP packaging blocked');
    expect(terminal.validationReport?.passed).toBe(false);
    expect(terminal.zipFilePath).toBeUndefined();
    expect(packageSpy).not.toHaveBeenCalled();
  });
});
