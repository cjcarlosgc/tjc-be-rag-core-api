import type { AnalysisRun, FunctionalQuestion, FunctionalQuestionStatus } from '../../generated/prisma/client.js';
import type { AnalysisSymbolResponse } from '../../analysis-runs/dto/analysis-run.response.js';

export interface VisualAidResponse {
  kind: 'STATE_DIAGRAM' | 'SYMBOL_RELATION' | 'MINI_DIFF' | 'CODE_FRAGMENT';
  title: string;
  content: string;
  language: string | null;
}

export interface FunctionalQuestionResponse {
  id: string;
  analysisRunId: string;
  projectId: string;
  repositoryName: string;
  pullRequestNumber: number;
  headSha: string;
  target: AnalysisSymbolResponse;
  question: string;
  rationale: string;
  status: FunctionalQuestionStatus;
  visualAid: VisualAidResponse | null;
  createdAt: string;
}

export interface FunctionalQuestionSetResponse {
  analysisRunId: string;
  currentQuestion: FunctionalQuestionResponse | null;
  functionalBehaviorValidated: boolean;
}

/** `visualAid` siempre null: sin generación de diagramas/fragmentos todavía. */
export function toFunctionalQuestionResponse(
  question: FunctionalQuestion,
  run: Pick<AnalysisRun, 'repositoryName' | 'prNumber' | 'headSha'>,
): FunctionalQuestionResponse {
  return {
    id: question.id,
    analysisRunId: question.analysisRunId,
    projectId: question.projectId,
    repositoryName: run.repositoryName,
    pullRequestNumber: run.prNumber,
    headSha: run.headSha,
    target: {
      language: question.symbolLanguage,
      kind: question.symbolKind,
      qualifiedName: question.qualifiedName,
      filePath: question.filePath,
      changeKind: 'DIRECTLY_CHANGED',
    },
    question: question.question,
    rationale: question.rationale,
    status: question.status,
    visualAid: null,
    createdAt: question.createdAt.toISOString(),
  };
}
