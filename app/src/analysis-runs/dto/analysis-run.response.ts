import type { AnalysisRun, AnalysisRunStatus } from '../../generated/prisma/client.js';

export type SymbolChangeKind = 'DIRECTLY_CHANGED' | 'POTENTIALLY_IMPACTED';

export interface AnalysisSymbolResponse {
  language: 'TYPESCRIPT' | 'PHP';
  kind: 'CLASS' | 'METHOD' | 'FUNCTION' | 'INTERFACE' | 'TYPE' | 'TRAIT' | 'ENUM';
  qualifiedName: string;
  filePath: string;
  changeKind: SymbolChangeKind;
}

export interface PullRequestRefResponse {
  repositoryId: string;
  repositoryName: string;
  number: number;
  title: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  draft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  actorLogin: string | null;
}

export interface AnalysisRunSummaryResponse {
  id: string;
  projectId: string;
  pullRequest: PullRequestRefResponse;
  status: AnalysisRunStatus;
  current: boolean;
  actionRequiredCount: number;
  generatedTestsCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AnalysisRunDetailResponse extends AnalysisRunSummaryResponse {
  attemptCount: number;
  indexMode: 'BOOTSTRAP' | 'INCREMENTAL';
  changesetBaseSha: string;
  changesetHeadSha: string;
  indexDeltaBaseSha: string | null;
  symbols: AnalysisSymbolResponse[];
  functionalBehaviorValidated: boolean;
  resultSummary: string | null;
  detailsUrl: string;
}

function toPullRequestRefResponse(run: AnalysisRun): PullRequestRefResponse {
  return {
    repositoryId: run.repositoryId,
    repositoryName: run.repositoryName,
    number: run.prNumber,
    title: run.prTitle,
    baseRef: run.baseRef,
    headRef: run.headRef,
    baseSha: run.baseSha,
    headSha: run.headSha,
    draft: run.draft,
    state: run.prState,
    actorLogin: run.actorLogin,
  };
}

export function toAnalysisRunSummaryResponse(run: AnalysisRun): AnalysisRunSummaryResponse {
  return {
    id: run.id,
    projectId: run.projectId,
    pullRequest: toPullRequestRefResponse(run),
    status: run.status,
    current: run.current,
    actionRequiredCount: run.actionRequiredCount,
    generatedTestsCount: run.generatedTestsCount,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

export function toAnalysisRunDetailResponse(run: AnalysisRun): AnalysisRunDetailResponse {
  return {
    ...toAnalysisRunSummaryResponse(run),
    attemptCount: run.attemptCount,
    indexMode: run.indexMode,
    changesetBaseSha: run.changesetBaseSha,
    changesetHeadSha: run.changesetHeadSha,
    indexDeltaBaseSha: run.indexDeltaBaseSha,
    symbols: [],
    functionalBehaviorValidated: run.functionalBehaviorValidated,
    resultSummary: run.resultSummary,
    detailsUrl: `/projects/${run.projectId}/runs/${run.id}`,
  };
}
