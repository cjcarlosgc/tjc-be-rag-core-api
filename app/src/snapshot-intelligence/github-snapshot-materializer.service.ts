import { Injectable, Logger } from '@nestjs/common';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { removeWorkspaceDir } from '../common/remove-workspace-dir.util.js';
import { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import { isComposerManifest, isIgnoredPath, isPhpPoolFile, isTypeScriptPoolFile } from '../project-versions/indexing.constants.js';
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
  private readonly logger = new Logger(GithubSnapshotMaterializerService.name);

  constructor(
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
  ) {}

  async materialize(binding: RepositoryBinding, sha: string): Promise<ExtractedWorkspace> {
    const dir = await mkdtemp(join(tmpdir(), 'rag-core-snapshot-'));

    try {
      const tree = await this.githubRepositoryContentService.getTree(
        binding.installationId,
        binding.repositoryName,
        sha,
      );
      const allPaths = tree.map((entry) => entry.path);
      // `pnpm-lock.yaml` no es un archivo "pool" (no se indexa como fuente),
      // pero el corte de Validation lo necesita para ejecutar en el Sandbox
      // (`interoperability-contract.md` §7.2: NODE_TYPESCRIPT lo exige,
      // ausencia -> UNSUPPORTED_PACKAGE_MANAGER); se incluye siempre que
      // exista, sin ampliar `isPoolFile` para no afectar la indexación.
      const phpProject = allPaths.some((path) =>
        !isIgnoredPath(path) && isComposerManifest(path),
      );
      const poolPaths = allPaths.filter((path) =>
        phpProject ? isPhpPoolFile(path) : isTypeScriptPoolFile(path),
      );

      await this.fetchAndWriteInBatches(binding.installationId, binding.repositoryName, sha, dir, poolPaths);

      return {
        dir,
        cleanup: () => removeWorkspaceDir(dir, this.logger),
      };
    } catch (error) {
      // La limpieza no lanza y se hace tras esperar a los escritores del lote,
      // de modo que el error original nunca queda enmascarado por ella.
      await removeWorkspaceDir(dir, this.logger);
      throw error;
    }
  }

  private async fetchAndWriteInBatches(
    installationId: string,
    repoFullName: string,
    sha: string,
    dir: string,
    paths: string[],
  ): Promise<void> {
    for (let i = 0; i < paths.length; i += CONTENT_FETCH_CONCURRENCY) {
      const batch = paths.slice(i, i + CONTENT_FETCH_CONCURRENCY);
      // `allSettled` espera a TODAS las escrituras del lote antes de limpiar:
      // con `Promise.all` el rechazo inmediato dejaba escritores activos
      // compitiendo con el `rm` (ENOTEMPTY que reemplazaba al error original).
      const results = await Promise.allSettled(
        batch.map(async (path) => {
          const content = await this.githubRepositoryContentService.getFileContent(
            installationId,
            repoFullName,
            path,
            sha,
          );
          const targetPath = join(dir, path);
          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, content, 'utf8');
        }),
      );
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (rejected) {
        throw rejected.reason;
      }
    }
  }
}
