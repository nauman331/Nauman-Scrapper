import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { SitePreviewService, previewEnvironment, PreviewBusyError } from '../src/generator/preview.service.js';
import { conversionStorage } from '../src/generator/storage.js';

afterEach(() => vi.restoreAllMocks());
describe('Local preview runtime', () => {
  it('does not pass scraper secrets or Node injection options to generated code', () => {
    const env = previewEnvironment({ PATH: '/node', SystemRoot: 'C:\\Windows', API_KEY: 'secret', DATABASE_URL: 'secret-db', NODE_OPTIONS: '--require malware', npm_config_token: 'token' });
    expect(env.PATH).toBe('/node');
    expect(env.API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.npm_config_token).toBeUndefined();
    expect(env.NEXT_TELEMETRY_DISABLED).toBe('1');
  });
  it('rejects invalid conversion IDs before runtime creation', () => {
    const service = new SitePreviewService();
    expect(() => service.start('../outside')).toThrow('Invalid conversion ID');
    expect(service.get('../outside')).toBeNull();
  });
  it('allows one preview, returns detached status, and stops cleanly during setup', async () => {
    vi.spyOn(fs, 'mkdir').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(conversionStorage, 'getProjectDir').mockImplementation((id) => `/missing-preview-source/${id}`);
    const service = new SitePreviewService();
    const record = service.start('test-preview');
    expect(record.status).toBe('INSTALLING');
    record.logs.push('external mutation');
    expect(service.get('test-preview')?.logs).not.toContain('external mutation');
    expect(() => service.start('another-preview')).toThrow(PreviewBusyError);
    expect((await service.stop('test-preview'))?.status).toBe('STOPPED');
    await service.close();
  });
});
