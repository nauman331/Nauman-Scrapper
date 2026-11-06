import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { staticValidator } from '../src/generator/validator/static-validator.js';

describe('Selected subpage project validation', () => {
  it('accepts /talk without inventing a homepage and still checks advertised routes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subpage-'));
    try {
      await fs.mkdir(path.join(root, 'src/app/talk'), { recursive: true });
      for (const file of ['package.json', 'tsconfig.json']) await fs.writeFile(path.join(root, file), '{}');
      await fs.writeFile(path.join(root, 'README.md'), 'fixture');
      await fs.writeFile(path.join(root, 'src/app/layout.tsx'), 'export default function Layout(){return <html><body/></html>}');
      await fs.writeFile(path.join(root, 'src/app/globals.css'), 'body{margin:0}');
      await fs.writeFile(path.join(root, 'src/app/talk/page.tsx'), 'export default function Page(){return <h1>Talk</h1>}');
      expect((await staticValidator.validateProject(root, ['/talk'], [], [])).passed).toBe(true);
      const missing = await staticValidator.validateProject(root, ['/talk', '/missing'], [], []);
      expect(missing.passed).toBe(false);
      expect(missing.errors).toContain('Missing required project file: src/app/missing/page.tsx');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
