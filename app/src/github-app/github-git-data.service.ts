import { Injectable } from '@nestjs/common';
import { GithubAppUnavailableError } from './github-app-auth.service.js';
import { GithubIntegrationClient } from './github-integration.client.js';

export interface PublicationRequest {
  installationId: string;
  repositoryName: string;
  pullRequestNumber: number;
  sourceHeadSha: string;
}

export type PublicationPreflight =
  | { status: 'READY' }
  | { status: 'STALE' }
  | { status: 'EXISTING_PR_CLOSED'; number: number };

export type ProposalBlobResult =
  | { status: 'UPLOADED'; path: string; blobSha: string }
  | { status: 'STALE' }
  | { status: 'EXISTING_PR_CLOSED'; number: number };

export type CompanionPullRequestResult =
  | {
      status: 'PUBLISHED';
      branchName: string;
      commitSha: string;
      pullRequest: { number: number; url: string };
    }
  | { status: 'STALE' }
  | { status: 'EXISTING_PR_CLOSED'; number: number };

export interface ProposalFileBlob {
  path: string;
  blobSha: string;
}

/**
 * Fachada de publicación de Core. Lee blobs desde su Storage y transmite el
 * contenido temporalmente a GitHub Integration, que es el único componente
 * que ejecuta Git Data API y Pulls API.
 */
@Injectable()
export class GithubGitDataService {
  constructor(private readonly integration: GithubIntegrationClient) {}

  async preflight(request: PublicationRequest): Promise<PublicationPreflight> {
    const result = await this.integration.post<PublicationPreflight>(
      '/publications/companion-pull-request/preflight',
      request,
    );
    return validatePreflight(result);
  }

  async uploadProposalBlob(
    request: PublicationRequest & { path: string; contentBase64: string },
  ): Promise<ProposalBlobResult> {
    const result = await this.integration.post<ProposalBlobResult>(
      '/publications/companion-pull-request/proposal-blobs',
      request,
      { timeoutMs: 180_000 },
    );
    return validateBlobResult(result, request.path);
  }

  async finalize(
    request: PublicationRequest & {
      sourceHeadRef: string;
      analysisRunId: string;
      proposalFiles: ProposalFileBlob[];
    },
  ): Promise<CompanionPullRequestResult> {
    const result = await this.integration.post<CompanionPullRequestResult>(
      '/publications/companion-pull-request',
      request,
      { timeoutMs: 180_000 },
    );
    return validateFinalizeResult(result);
  }
}

function validatePreflight(value: unknown): PublicationPreflight {
  if (isRecord(value) && value.status === 'READY') return { status: 'READY' };
  if (isRecord(value) && value.status === 'STALE') return { status: 'STALE' };
  if (
    isRecord(value) &&
    value.status === 'EXISTING_PR_CLOSED' &&
    Number.isSafeInteger(value.number) &&
    (value.number as number) > 0
  ) {
    return { status: 'EXISTING_PR_CLOSED', number: value.number as number };
  }
  throw malformedResponse();
}

function validateBlobResult(value: unknown, requestedPath: string): ProposalBlobResult {
  if (isRecord(value) && value.status === 'STALE') return { status: 'STALE' };
  if (
    isRecord(value) &&
    value.status === 'EXISTING_PR_CLOSED' &&
    Number.isSafeInteger(value.number) &&
    (value.number as number) > 0
  ) {
    return { status: 'EXISTING_PR_CLOSED', number: value.number as number };
  }
  if (
    isRecord(value) &&
    value.status === 'UPLOADED' &&
    value.path === requestedPath &&
    typeof value.blobSha === 'string' &&
    value.blobSha.length > 0
  ) {
    return { status: 'UPLOADED', path: value.path, blobSha: value.blobSha };
  }
  throw malformedResponse();
}

function validateFinalizeResult(value: unknown): CompanionPullRequestResult {
  if (isRecord(value) && value.status === 'STALE') return { status: 'STALE' };
  if (
    isRecord(value) &&
    value.status === 'EXISTING_PR_CLOSED' &&
    Number.isSafeInteger(value.number) &&
    (value.number as number) > 0
  ) {
    return { status: 'EXISTING_PR_CLOSED', number: value.number as number };
  }
  if (
    isRecord(value) &&
    value.status === 'PUBLISHED' &&
    typeof value.branchName === 'string' &&
    typeof value.commitSha === 'string' &&
    isRecord(value.pullRequest) &&
    Number.isSafeInteger(value.pullRequest.number) &&
    (value.pullRequest.number as number) > 0 &&
    typeof value.pullRequest.url === 'string' &&
    isHttpsUrl(value.pullRequest.url)
  ) {
    return {
      status: 'PUBLISHED',
      branchName: value.branchName,
      commitSha: value.commitSha,
      pullRequest: {
        number: value.pullRequest.number as number,
        url: value.pullRequest.url,
      },
    };
  }
  throw malformedResponse();
}

function malformedResponse(): GithubAppUnavailableError {
  return new GithubAppUnavailableError('GitHub Integration devolvió una respuesta inválida.', 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
