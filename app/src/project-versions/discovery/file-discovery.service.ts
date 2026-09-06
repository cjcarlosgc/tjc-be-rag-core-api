import { Injectable } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isIgnoredPath, isPoolFile } from '../indexing.constants.js';

@Injectable()
export class FileDiscoveryService {
  async discover(rootDir: string): Promise<string[]> {
    const discovered: string[] = [];
    await this.walk(rootDir, rootDir, discovered);
    return discovered;
  }

  private async walk(rootDir: string, currentDir: string, discovered: string[]): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = relative(rootDir, absolutePath).split('\\').join('/');

      if (isIgnoredPath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.walk(rootDir, absolutePath, discovered);
        continue;
      }

      if (entry.isFile() && isPoolFile(relativePath)) {
        discovered.push(relativePath);
      }
    }
  }
}
