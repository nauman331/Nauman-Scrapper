import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import type { GeneratedFileNode } from './types.js';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'conversions');

export class ConversionStorage {
  private baseDir: string;

  constructor(baseDir = STORAGE_ROOT) {
    this.baseDir = baseDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  getConversionDir(conversionId: string): string {
    this.assertValidId(conversionId);
    return path.join(this.baseDir, conversionId);
  }

  getProjectDir(conversionId: string): string {
    return path.join(this.getConversionDir(conversionId), 'project');
  }

  getZipPath(conversionId: string, projectName: string): string {
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.getConversionDir(conversionId), `${safeName}.zip`);
  }

  async setupConversionWorkspace(conversionId: string): Promise<string> {
    const convDir = this.getConversionDir(conversionId);
    const projDir = this.getProjectDir(conversionId);
    await fs.mkdir(convDir, { recursive: true });
    await fs.mkdir(projDir, { recursive: true });
    return projDir;
  }

  /**
   * Writes a file safely inside the project directory, strictly verifying no path traversal.
   */
  async writeFileSafe(
    conversionId: string,
    relativeFilePath: string,
    content: string | Buffer
  ): Promise<string> {
    const projDir = path.resolve(this.getProjectDir(conversionId));
    const absoluteTarget = path.resolve(projDir, relativeFilePath);

    if (!absoluteTarget.startsWith(projDir + path.sep) && absoluteTarget !== projDir) {
      throw new Error(`Security Violation: Path traversal attempt detected for path '${relativeFilePath}'`);
    }

    const parentDir = path.dirname(absoluteTarget);
    await fs.mkdir(parentDir, { recursive: true });

    if (typeof content === 'string') {
      await fs.writeFile(absoluteTarget, content, 'utf8');
    } else {
      await fs.writeFile(absoluteTarget, content);
    }

    return absoluteTarget;
  }

  async readFileSafe(conversionId: string, relativeFilePath: string): Promise<string | null> {
    const projDir = path.resolve(this.getProjectDir(conversionId));
    const absoluteTarget = path.resolve(projDir, relativeFilePath);

    if (!absoluteTarget.startsWith(projDir + path.sep) && absoluteTarget !== projDir) {
      throw new Error(`Security Violation: Path traversal attempt detected for path '${relativeFilePath}'`);
    }

    if (!existsSync(absoluteTarget)) {
      return null;
    }

    if (/\.(png|jpe?g|gif|webp|avif|ico)$/i.test(relativeFilePath)) {
      return (await fs.readFile(absoluteTarget)).toString('base64');
    }
    return fs.readFile(absoluteTarget, 'utf8');
  }

  async readPreviewFileSafe(conversionId: string, relativeFilePath: string): Promise<Buffer | null> {
    const projectDir = await fs.realpath(this.getProjectDir(conversionId));
    const target = path.resolve(projectDir, relativeFilePath);
    if (!target.startsWith(projectDir + path.sep)) throw new Error('Invalid preview path.');
    try {
      const realTarget = await fs.realpath(target);
      if (!realTarget.startsWith(projectDir + path.sep)) throw new Error('Invalid preview path.');
      if (!(await fs.stat(realTarget)).isFile()) return null;
      return await fs.readFile(realTarget);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async buildFileTree(conversionId: string): Promise<GeneratedFileNode> {
    const projDir = this.getProjectDir(conversionId);
    return this.scanDirectory(projDir, '');
  }

  private async scanDirectory(absoluteDir: string, relativeDir: string): Promise<GeneratedFileNode> {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    const children: GeneratedFileNode[] = [];

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absPath = path.join(absoluteDir, entry.name);

      if (entry.isDirectory()) {
        const subTree = await this.scanDirectory(absPath, relPath);
        children.push(subTree);
      } else {
        const stat = await fs.stat(absPath);
        children.push({
          name: entry.name,
          path: relPath,
          type: 'file',
          size: stat.size,
        });
      }
    }

    return {
      name: relativeDir ? path.basename(relativeDir) : 'project',
      path: relativeDir || '.',
      type: 'directory',
      children,
    };
  }

  createZipStream(zipPath: string): NodeJS.ReadableStream {
    if (!existsSync(zipPath)) {
      throw new Error(`ZIP archive not found at ${zipPath}`);
    }
    return createReadStream(zipPath);
  }

  async deleteConversion(conversionId: string): Promise<void> {
    const convDir = this.getConversionDir(conversionId);
    if (existsSync(convDir)) {
      await fs.rm(convDir, { recursive: true, force: true });
    }
  }

  private assertValidId(id: string): void {
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid conversion ID format: '${id}'`);
    }
  }
}

export const conversionStorage = new ConversionStorage();
