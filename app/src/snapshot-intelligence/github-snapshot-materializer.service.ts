import { Injectable } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GithubAppAuthService } from '../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import { isPoolFile } from '../project-versions/indexing.constants.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';
import type { ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';

const CONTENT_FETCH_CONCURRENCY = 8;

/**
 * Materializa un HEAD de GitHub en un directorio temporal, produciendo el
 * mismo `ExtractedWorkspace` que `ZipExtractionService` para que el resto
 * del pipeline de indexación (discovery/parsing/inventory) se reutilice sin
 * cambios, sin importar el origen del snapshot.
 */
@Injectable()
export class GithubSnapshotMaterializerService {
  constructor(
    private readonly githubAppAuthService: GithubAppAuthService,
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
  ) {}

  async materialize(binding: RepositoryBinding, sha: string): Promise<ExtractedWorkspace> {
    const dir = await mkdtemp(join(tmpdir(), 'rag-core-snapshot-'));

    try {
      const token = await this.githubAppAuthService.getInstallationToken(binding.installationId);
      const tree = await this.githubRepositoryContentService.getTree(
        binding.repositoryName,
        sha,
        token,
      );
      const allPaths = tree.map((entry) => entry.path);
      // `pnpm-lock.yaml` no es un archivo "pool" (no se indexa como fuente),
      // pero el corte de Validation lo necesita para ejecutar en el Sandbox
      // (`interoperability-contract.md` §7.2: NODE_TYPESCRIPT lo exige,
      // ausencia -> UNSUPPORTED_PACKAGE_MANAGER); se incluye siempre que
      // exista, sin ampliar `isPoolFile` para no afectar la indexación.
      const poolPaths = allPaths.filter((path) => isPoolFile(path) || path === 'pnpm-lock.yaml');

      await this.fetchAndWriteInBatches(binding.repositoryName, sha, token, dir, poolPaths);

      return {
        dir,
        cleanup: () => rm(dir, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  private async fetchAndWriteInBatches(
    repoFullName: string,
    sha: string,
    token: string,
    dir: string,
    paths: string[],
  ): Promise<void> {
    for (let i = 0; i < paths.length; i += CONTENT_FETCH_CONCURRENCY) {
      const batch = paths.slice(i, i + CONTENT_FETCH_CONCURRENCY);
      await Promise.all(
        batch.map(async (path) => {
          const content = await this.githubRepositoryContentService.getFileContent(
            repoFullName,
            path,
            sha,
            token,
          );
          const targetPath = join(dir, path);
          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, content, 'utf8');
        }),
      );
    }
  }
}
