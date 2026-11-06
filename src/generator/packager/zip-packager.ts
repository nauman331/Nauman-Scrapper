import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as archiverModule from 'archiver';
import { logger } from '../../monitoring/logger.js';

export interface ZipResult {
  zipPath: string;
  sizeBytes: number;
  totalEntries: number;
}

export class ZipPackager {
  /**
   * Packages project directory into a sanitized ZIP archive
   */
  async packageProject(projectDir: string, outputZipPath: string): Promise<ZipResult> {
    if (!fs.existsSync(projectDir)) {
      throw new Error(`Cannot package non-existent project directory: ${projectDir}`);
    }

    // Ensure output directory exists
    await fsp.mkdir(path.dirname(outputZipPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputZipPath);

      // Support both archiver v7 (ZipArchive class) and v5/v6 factory function
      let archive: any;
      if (typeof archiverModule.ZipArchive === 'function') {
        archive = new archiverModule.ZipArchive({ zlib: { level: 9 } });
      } else if (typeof (archiverModule as any).default === 'function') {
        archive = (archiverModule as any).default('zip', { zlib: { level: 9 } });
      } else if (typeof (archiverModule as any) === 'function') {
        archive = (archiverModule as any)('zip', { zlib: { level: 9 } });
      } else {
        throw new Error('Could not initialize zip archive engine');
      }

      let totalEntries = 0;

      output.on('close', () => {
        const sizeBytes = typeof archive.pointer === 'function' ? archive.pointer() : 0;
        logger.info(
          { zipPath: outputZipPath, bytes: sizeBytes, entries: totalEntries },
          'Project archive created successfully'
        );
        resolve({
          zipPath: outputZipPath,
          sizeBytes,
          totalEntries,
        });
      });

      archive.on('entry', () => {
        totalEntries++;
      });

      archive.on('warning', (err: any) => {
        if (err.code === 'ENOENT') {
          logger.warn({ error: err }, 'Archiver non-fatal warning');
        } else {
          reject(err);
        }
      });

      archive.on('error', (err: any) => {
        reject(err);
      });

      archive.pipe(output);

      // Recursively add all files from project directory
      archive.directory(projectDir, false);

      archive.finalize().catch(reject);
    });
  }
}

export const zipPackager = new ZipPackager();
