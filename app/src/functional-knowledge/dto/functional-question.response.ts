import type {
  AnalysisRun,
  FunctionalQuestion,
  FunctionalQuestionAbstention,
  FunctionalQuestionStatus,
  ScenarioKind,
} from '../../generated/prisma/client.js';
import type { AnalysisSymbolResponse } from '../../analysis-runs/dto/analysis-run.response.js';

export interface VisualAidResponse {
  kind: 'STATE_DIAGRAM' | 'SYMBOL_RELATION' | 'MINI_DIFF' | 'CODE_FRAGMENT';
  title: string;
  content: string;
  language: string | null;
}

/** Roles que pueden registrar una abstención (DEC-FK-002). */
export type ConfirmingRole = 'ADMIN' | 'MAINTAINER';

export interface FunctionalAbstentionSummary {
  count: number;
  lastAt: string;
  lastByUserId: string;
  lastByRole: ConfirmingRole;
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
  scenarioKind: ScenarioKind;
  scenarioKey: string;
  abstention: FunctionalAbstentionSummary | null;
  createdAt: string;
}

export interface FunctionalQuestionSetResponse {
  analysisRunId: string;
  currentQuestion: FunctionalQuestionResponse | null;
  functionalBehaviorValidated: boolean;
}

/**
 * Resumen de abstenciones calculado de sus filas. `rows` debe venir ordenado `createdAt desc, id desc`,
 * como lo garantizan las consultas del repositorio; la primera fila es la más reciente.
 * Sin filas, `null`.
 */
export function summarizeAbstentions(
  rows: ReadonlyArray<Pick<FunctionalQuestionAbstention, 'userId' | 'role' | 'createdAt'>>,
): FunctionalAbstentionSummary | null {
  const [latest] = rows;

  if (!latest) {
    return null;
  }

  return {
    count: rows.length,
    lastAt: latest.createdAt.toISOString(),
    lastByUserId: latest.userId,
    // El repositorio solo inserta ADMIN o MAINTAINER (`recordAbstention` lo exige por tipo).
    lastByRole: latest.role as ConfirmingRole,
  };
}

/**
 * `visualAid` siempre null: sin generación de diagramas/fragmentos todavía.
 * Preguntas históricas (columnas de escenario nulas): `EXPECTED_RESULT` y `LEGACY` (DEC-FK-004).
 */
export function toFunctionalQuestionResponse(
  question: FunctionalQuestion & { abstentions?: FunctionalQuestionAbstention[] },
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
    scenarioKind: question.scenarioKind ?? 'EXPECTED_RESULT',
    scenarioKey: question.scenarioKey ?? 'LEGACY',
    abstention: summarizeAbstentions(question.abstentions ?? []),
    createdAt: question.createdAt.toISOString(),
  };
}
