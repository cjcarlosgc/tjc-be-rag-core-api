import type { FunctionalKnowledge } from '../../generated/prisma/client.js';

export interface FunctionalKnowledgeResponse {
  id: string;
  projectId: string;
  scope: FunctionalKnowledge['scope'];
  targetRef: string | null;
  originalQuestion: string;
  originalAnswer: string;
  normalizedRule: string;
  source: FunctionalKnowledge['source'];
  status: FunctionalKnowledge['status'];
  supersedesId: string | null;
  /** INTEROP-2.7 (WI-CORE-019): null en reglas históricas anteriores a la procedencia. */
  confirmedByUserId: string | null;
  confirmedRole: FunctionalKnowledge['confirmedRole'];
  /** Procedencia, no vencimiento: la vigencia no depende de este campo. */
  originHeadSha: string | null;
  /** Solo para `source = APPROVED_IMPORT`. */
  sourceRef: string | null;
  createdAt: string;
}

export interface FunctionalKnowledgeConflictResponse {
  conflictId: string;
  analysisRunId: string;
  questionId: string;
  conflictingKnowledge: FunctionalKnowledgeResponse;
  proposedNormalizedRule: string;
}

export function toFunctionalKnowledgeResponse(knowledge: FunctionalKnowledge): FunctionalKnowledgeResponse {
  return {
    id: knowledge.id,
    projectId: knowledge.projectId,
    scope: knowledge.scope,
    targetRef: knowledge.targetRef,
    originalQuestion: knowledge.originalQuestion,
    originalAnswer: knowledge.originalAnswer,
    normalizedRule: knowledge.normalizedRule,
    source: knowledge.source,
    status: knowledge.status,
    supersedesId: knowledge.supersedesId,
    // `?? null` cubre tanto NULL de histórico como propiedades ausentes en filas parciales.
    confirmedByUserId: knowledge.confirmedByUserId ?? null,
    confirmedRole: knowledge.confirmedRole ?? null,
    originHeadSha: knowledge.originHeadSha ?? null,
    sourceRef: knowledge.sourceRef ?? null,
    createdAt: knowledge.createdAt.toISOString(),
  };
}
