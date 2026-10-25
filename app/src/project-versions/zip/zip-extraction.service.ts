import { Injectable, Logger } from '@nestjs/common';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { removeWorkspaceDir } from '../../common/remove-workspace-dir.util.js';
import { listSafeZipEntries } from './zip-entries.util.js';

export interface ExtractedWorkspace {
  dir: string;
  cleanup: () => Promise<void>;
}

@Injectable()
export class ZipExtractionService {
  private readonly logger = new Logger(ZipExtractionService.name);

  async extract(buffer: Buffer): Promise<ExtractedWorkspace> {
    const dir = await mkdtemp(join(tmpdir(), 'rag-core-'));

    try {
      const entries = listSafeZipEntries(buffer);

      for (const entry of entries) {
        if (entry.isDirectory) {
          continue;
        }

        const targetPath = resolve(dir, entry.entryName);

        if (!targetPath.startsWith(dir + sep)) {
          throw new Error(`Ruta de extracción fuera del workspace: "${entry.entryName}".`);
        }

        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, entry.getData());
      }

      return {
        dir,
        cleanup: () => removeWorkspaceDir(dir, this.logger),
      };
    } catch (error) {
      await removeWorkspaceDir(dir, this.logger);
      throw error;
    }
  }
}
