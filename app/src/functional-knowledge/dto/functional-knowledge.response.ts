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
    createdAt: knowledge.createdAt.toISOString(),
  };
}
