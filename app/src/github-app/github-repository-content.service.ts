import { Injectable, Logger } from '@nestjs/common';
import { GithubAppUnavailableError } from './github-app-auth.service.js';
import {
  GithubIntegrationClient,
  GithubIntegrationClientError,
} from './github-integration.client.js';

export interface CompareFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  previousFilename?: string;
}

export interface TreeEntry {
  path: string;
}

export interface RepositoryBranch {
  name: string;
  protected: boolean;
}

export interface PullRequestHead {
  headSha: string;
  state: 'open' | 'closed';
  createdAt: string;
}

type GithubLookup<T> =
  | { status: 'OK'; value: T }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_INSTALLED' }
  | { status: 'UNVERIFIABLE' };

/**
 * Fachada Core para lecturas GitHub. Toda comunicación con GitHub ocurre en
 * GitHub Integration; Core solo recibe datos ligados al installationId/SHA.
 */
@Injectable()
export class GithubRepositoryContentService {
  private readonly logger = new Logger(GithubRepositoryContentService.name);

  constructor(private readonly integration: GithubIntegrationClient) {}

  async compare(
    installationId: string,
    repositoryName: string,
    baseSha: string,
    headSha: string,
  ): Promise<CompareFile[]> {
    const result = await this.postLookup<{ files: CompareFile[] }>(
      '/repositories/compare',
      { installationId, repositoryName, baseSha, headSha },
    );
    const value = unwrapLookup<{ files: CompareFile[] }>(result, 'No se pudo verificar el compare de GitHub.');
    if (!Array.isArray(value.files) || !value.files.every(isCompareFile)) {
      throw invalidLookupResponse();
    }
    return value.files;
  }

  async getTree(
    installationId: string,
    repositoryName: string,
    commitSha: string,
  ): Promise<TreeEntry[]> {
    const result = await this.postLookup<{ paths: string[]; truncated: boolean }>(
      '/repositories/tree',
      { installationId, repositoryName, commitSha },
    );
    const tree = unwrapLookup<{ paths: string[]; truncated: boolean }>(
      result,
      'No se pudo verificar el árbol de GitHub.',
    );
    if (!Array.isArray(tree.paths) || !tree.paths.every(isNonEmptyString) || typeof tree.truncated !== 'boolean') {
      throw invalidLookupResponse();
    }
    if (tree.truncated) {
      this.logger.warn('GitHub Integration devolvió un árbol truncado; se procesa el subconjunto verificado.');
    }
    return tree.paths.map((path) => ({ path }));
  }

  async getFileContent(
    installationId: string,
    repositoryName: string,
    path: string,
    commitSha: string,
  ): Promise<string> {
    const result = await this.postLookup<{
      files: Array<{ path: string; contentBase64: string }>;
    }>('/repositories/files:batch', {
      installationId,
      repositoryName,
      commitSha,
      paths: [path],
    });
    const { files } = unwrapLookup<{ files: Array<{ path: string; contentBase64: string }> }>(
      result,
      'No se pudo verificar el contenido del repositorio.',
    );
    if (!Array.isArray(files) || !files.every(isRepositoryFile)) throw invalidLookupResponse();
    const file = files.find((candidate) => candidate.path === path);
    if (!file || typeof file.contentBase64 !== 'string') {
      throw new GithubAppUnavailableError('GitHub Integration devolvió un contenido incompleto.', 503);
    }
    return Buffer.from(file.contentBase64, 'base64').toString('utf8');
  }

  async listBranches(
    installationId: string,
    repositoryName: string,
  ): Promise<RepositoryBranch[]> {
    const result = await this.postLookup<{ items: RepositoryBranch[] }>(
      '/repositories/branches',
      { installationId, repositoryName },
    );
    const value = unwrapLookup<{ items: RepositoryBranch[] }>(
      result,
      'No se pudieron verificar las ramas de GitHub.',
    );
    if (!Array.isArray(value.items) || !value.items.every(isRepositoryBranch)) {
      throw invalidLookupResponse();
    }
    return value.items;
  }

  async getPullRequestHead(
    installationId: string,
    repositoryName: string,
    pullRequestNumber: number,
  ): Promise<PullRequestHead> {
    const result = await this.postLookup<PullRequestHead>(
      '/repositories/pull-request-head',
      { installationId, repositoryName, pullRequestNumber },
    );
    const value = unwrapLookup<PullRequestHead>(
      result,
      'No se pudo verificar el pull request de GitHub.',
    );
    if (!isPullRequestHead(value)) throw invalidLookupResponse();
    return value;
  }

  private async postLookup<T>(path: string, body: unknown): Promise<GithubLookup<T>> {
    try {
      return await this.integration.post<GithubLookup<T>>(path, body);
    } catch (error) {
      if (error instanceof GithubIntegrationClientError) {
        throw new GithubAppUnavailableError('GitHub Integration no está disponible.', 503);
      }
      throw new GithubAppUnavailableError('No se pudo completar la operación de GitHub Integration.', 503);
    }
  }
}

function unwrapLookup<T>(result: unknown, message: string): T {
  if (!isRecord(result) || typeof result.status !== 'string') throw invalidLookupResponse();
  switch (result.status) {
    case 'OK':
      if (!Object.hasOwn(result, 'value')) throw invalidLookupResponse();
      return result.value as T;
    case 'NOT_FOUND':
      throw new GithubAppUnavailableError(message, 404);
    case 'NOT_INSTALLED':
      throw new GithubAppUnavailableError(message, 403);
    case 'UNVERIFIABLE':
      throw new GithubAppUnavailableError(message, 503);
    default:
      throw invalidLookupResponse();
  }
}

function isCompareFile(value: unknown): value is CompareFile {
  if (!isRecord(value) || !isNonEmptyString(value.filename)) return false;
  const statuses: CompareFile['status'][] = ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'];
  return statuses.includes(value.status as CompareFile['status']) &&
    (value.previousFilename === undefined || typeof value.previousFilename === 'string');
}

function isRepositoryFile(value: unknown): value is { path: string; contentBase64: string } {
  return isRecord(value) && isNonEmptyString(value.path) && typeof value.contentBase64 === 'string';
}

function isRepositoryBranch(value: unknown): value is RepositoryBranch {
  return isRecord(value) && isNonEmptyString(value.name) && typeof value.protected === 'boolean';
}

function isPullRequestHead(value: unknown): value is PullRequestHead {
  return (
    isRecord(value) &&
    isNonEmptyString(value.headSha) &&
    (value.state === 'open' || value.state === 'closed') &&
    isIsoDateTime(value.createdAt)
  );
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalidLookupResponse(): GithubAppUnavailableError {
  return new GithubAppUnavailableError('GitHub Integration devolvió una respuesta inválida.', 503);
}
