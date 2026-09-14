import { Injectable, Logger } from '@nestjs/common';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const GITHUB_API_VERSION = '2022-11-28';

export interface CompareFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  previousFilename?: string;
}

export interface TreeEntry {
  path: string;
}

interface GithubApiCompareResponse {
  files?: Array<{ filename: string; status: CompareFile['status']; previous_filename?: string }>;
}

interface GithubApiTreeResponse {
  tree: Array<{ path: string; type: string }>;
  truncated: boolean;
}

interface GithubApiContentsResponse {
  content: string;
  encoding: string;
}

/**
 * Llamadas de solo lectura a la API REST de GitHub necesarias para HU33/34.
 * `repoFullName` es `owner/repo` (`RepositoryBinding.repositoryName`).
 */
@Injectable()
export class GithubRepositoryContentService {
  private readonly logger = new Logger(GithubRepositoryContentService.name);

  /**
   * `PR CHANGESET`/`INDEX DELTA` (`spec/contracts/system-contract.md`): la
   * API pagina `files` en bloques de 100 con un máximo de 300 por respuesta;
   * se sigue `page` hasta agotar resultados.
   */
  async compare(repoFullName: string, base: string, head: string, token: string): Promise<CompareFile[]> {
    const files: CompareFile[] = [];
    let page = 1;

    for (;;) {
      const response = await this.request(
        `https://api.github.com/repos/${repoFullName}/compare/${base}...${head}?per_page=100&page=${page}`,
        token,
      );
      const data = (await response.json()) as GithubApiCompareResponse;
      const pageFiles = data.files ?? [];

      files.push(
        ...pageFiles.map((f) => ({
          filename: f.filename,
          status: f.status,
          ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
        })),
      );

      if (pageFiles.length < 100) {
        break;
      }

      page += 1;
    }

    return files;
  }

  /** Árbol recursivo del commit `sha`; solo entradas `blob` (archivos). */
  async getTree(repoFullName: string, sha: string, token: string): Promise<TreeEntry[]> {
    const response = await this.request(
      `https://api.github.com/repos/${repoFullName}/git/trees/${sha}?recursive=1`,
      token,
    );
    const data = (await response.json()) as GithubApiTreeResponse;

    if (data.truncated) {
      this.logger.warn(
        `El árbol de "${repoFullName}"@"${sha}" viene truncado por GitHub; se procesa un subconjunto.`,
      );
    }

    return data.tree.filter((entry) => entry.type === 'blob').map((entry) => ({ path: entry.path }));
  }

  /** Contenido de un archivo en texto plano. Límite de la Contents API: 1MB por archivo. */
  async getFileContent(repoFullName: string, path: string, sha: string, token: string): Promise<string> {
    const response = await this.request(
      `https://api.github.com/repos/${repoFullName}/contents/${path}?ref=${sha}`,
      token,
    );
    const data = (await response.json()) as GithubApiContentsResponse;

    return Buffer.from(data.content, data.encoding as BufferEncoding).toString('utf8');
  }

  private async request(url: string, token: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GithubAppUnavailableError(`GitHub API ${response.status} en ${url}: ${body}`);
    }

    return response;
  }
}
