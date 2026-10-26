import { Injectable, Logger } from '@nestjs/common';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { removeWorkspaceDir } from '../common/remove-workspace-dir.util.js';
import { GithubRepositoryContentService } from '../github-app/github-repository-content.service.js';
import {
  isComposerManifest,
  isIgnoredPath,
  isPhpPoolFile,
  isSandboxFixtureFile,
  isTypeScriptPoolFile,
  SANDBOX_FIXTURE_LIMITS,
} from '../project-versions/indexing.constants.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';
import type { ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';

const CONTENT_FETCH_CONCURRENCY = 8;

/** Resultado de `addSandboxFixtures`: solo contadores, nunca rutas ni contenido. */
export interface SandboxFixturesReport {
  requested: number;
  included: number;
  bytes: number;
  omitted: {
    maxFiles: number;
    fetchFailed: number;
    fileTooLarge: number;
    notUtf8: number;
    highCompression: number;
    totalLimit: number;
  };
}

function emptyFixturesReport(): SandboxFixturesReport {
  return {
    requested: 0,
    included: 0,
    bytes: 0,
    omitted: { maxFiles: 0, fetchFailed: 0, fileTooLarge: 0, notUtf8: 0, highCompression: 0, totalLimit: 0 },
  };
}

function isSafeRelativePath(workspaceDir: string, path: string): boolean {
  if (path === '' || isAbsolute(path) || path.split('/').includes('..')) {
    return false;
  }
  const rel = relative(resolve(workspaceDir), resolve(workspaceDir, path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

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

  /**
   * Añade al workspace los fixtures de texto que necesita el Sandbox (WI-CORE-102).
   * Se llama DESPUÉS de indexar y justo antes de zipear, de modo que índice,
   * discovery y herramientas del agente no los ven. Nunca lanza: lo que no se
   * puede incluir se omite y solo se registran contadores (sin rutas ni contenido).
   */
  async addSandboxFixtures(
    binding: RepositoryBinding,
    sha: string,
    workspaceDir: string,
  ): Promise<SandboxFixturesReport> {
    const report = emptyFixturesReport();
    try {
      const tree = await this.githubRepositoryContentService.getTree(
        binding.installationId,
        binding.repositoryName,
        sha,
      );
      const allPaths = tree.map((entry) => entry.path);
      const phpProject = allPaths.some((path) => !isIgnoredPath(path) && isComposerManifest(path));
      if (!phpProject) {
        return report;
      }

      const candidates = allPaths.filter((path) => isSandboxFixtureFile(path)).sort();
      report.requested = candidates.length;
      const attempted = candidates.slice(0, SANDBOX_FIXTURE_LIMITS.maxFiles);
      report.omitted.maxFiles = candidates.length - attempted.length;

      for (let i = 0; i < attempted.length; i += CONTENT_FETCH_CONCURRENCY) {
        const batch = attempted.slice(i, i + CONTENT_FETCH_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (path) => {
            if (!isSafeRelativePath(workspaceDir, path)) {
              throw new Error('unsafe path');
            }
            return this.githubRepositoryContentService.getFileContent(
              binding.installationId,
              binding.repositoryName,
              path,
              sha,
            );
          }),
        );

        for (let j = 0; j < batch.length; j += 1) {
          const result = results[j];
          if (result.status === 'rejected' || typeof result.value !== 'string') {
            report.omitted.fetchFailed += 1;
            continue;
          }
          const content = result.value;
          if (content.includes('\uFFFD')) {
            report.omitted.notUtf8 += 1;
            continue;
          }
          const size = Buffer.byteLength(content, 'utf8');
          if (size > SANDBOX_FIXTURE_LIMITS.maxFileBytes) {
            report.omitted.fileTooLarge += 1;
            continue;
          }
          // El extractor del Sandbox rechaza todo el snapshot si una entrada supera ratio 100.
          const compressed = deflateRawSync(Buffer.from(content, 'utf8')).length;
          if (size / Math.max(compressed, 1) > SANDBOX_FIXTURE_LIMITS.maxCompressionRatio) {
            report.omitted.highCompression += 1;
            continue;
          }
          if (report.bytes + size > SANDBOX_FIXTURE_LIMITS.maxTotalBytes) {
            report.omitted.totalLimit += 1;
            continue;
          }
          try {
            const targetPath = join(workspaceDir, batch[j]);
            await mkdir(dirname(targetPath), { recursive: true });
            await writeFile(targetPath, content, 'utf8');
          } catch {
            report.omitted.fetchFailed += 1;
            continue;
          }
          report.included += 1;
          report.bytes += size;
        }
      }
    } catch {
      this.logger.warn('No se pudieron completar los fixtures del snapshot del Sandbox; se continúa con el informe parcial.');
    }

    this.logger.log(
      `Fixtures del snapshot del Sandbox: requested=${report.requested} included=${report.included} bytes=${report.bytes}`,
    );
    const { maxFiles, fetchFailed, fileTooLarge, notUtf8, highCompression, totalLimit } = report.omitted;
    if (maxFiles + fetchFailed + fileTooLarge + notUtf8 + highCompression + totalLimit > 0) {
      this.logger.warn(
        `Fixtures omitidos del snapshot del Sandbox: maxFiles=${maxFiles} fetchFailed=${fetchFailed} fileTooLarge=${fileTooLarge} notUtf8=${notUtf8} highCompression=${highCompression} totalLimit=${totalLimit}`,
      );
    }
    return report;
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
