import type { TestPublication } from '../../generated/prisma/client.js';

export interface TestPublicationAcceptedResponse {
  status: 'PENDING';
  pollAfterMs: number;
  publicationId: string;
  analysisRunId: string;
}

export interface TestPublicationResponse {
  id: string;
  analysisRunId: string;
  sourceHeadSha: string;
  status: TestPublication['status'];
  branchName: string | null;
  companionPullRequestNumber: number | null;
  companionPullRequestUrl: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toTestPublicationResponse(publication: TestPublication): TestPublicationResponse {
  return {
    id: publication.id,
    analysisRunId: publication.analysisRunId,
    sourceHeadSha: publication.sourceHeadSha,
    status: publication.status,
    branchName: publication.branchName,
    companionPullRequestNumber: publication.companionPullRequestNumber,
    companionPullRequestUrl: publication.companionPullRequestUrl,
    failureMessage: publication.failureMessage,
    createdAt: publication.createdAt.toISOString(),
    updatedAt: publication.updatedAt.toISOString(),
  };
}
