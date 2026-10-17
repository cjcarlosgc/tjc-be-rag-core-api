import { Injectable } from '@nestjs/common';
import { FunctionalKnowledgeRepository } from '../functional-knowledge/functional-knowledge.repository.js';
import type { FunctionalKnowledge } from '../generated/prisma/client.js';
import type { FunctionalRule, RetrievalTarget } from './generation-context.js';

/**
 * `targetRef` de una regla: `filePath::qualifiedName`, con la misma forma que `symbolTargetRef`
 * (functional-context-evaluator). Inverso de `toRetrievalTarget`: METHOD → `Clase.metodo`, FUNCTION → nombre.
 */
export function functionalTargetRef(target: RetrievalTarget): string {
  const qualifiedName =
    target.targetType === 'METHOD' && target.methodName !== null
      ? `${target.symbolName}.${target.methodName}`
      : target.symbolName;

  return `${target.filePath}::${qualifiedName}`;
}

function toFunctionalRule(row: FunctionalKnowledge): FunctionalRule {
  return {
    knowledgeId: row.id,
    scenarioKey: row.scenarioKey,
    normalizedRule: row.normalizedRule,
    scope: row.scope,
    targetRef: row.targetRef ?? '',
    source: row.source,
    provenance: {
      confirmedByUserId: row.confirmedByUserId,
      confirmedRole: row.confirmedRole,
      originHeadSha: row.originHeadSha,
      sourceRef: row.sourceRef,
    },
  };
}

/**
 * Recuperador determinista de reglas funcionales (WI-CORE-021). No usa embeddings, chunks ni pgvector:
 * devuelve las reglas ACTIVE del Project cuyo `targetRef` coincide exactamente con el target.
 */
@Injectable()
export class FunctionalRulesRetriever {
  constructor(private readonly functionalKnowledgeRepository: FunctionalKnowledgeRepository) {}

  async retrieve(projectId: string, target: RetrievalTarget): Promise<FunctionalRule[]> {
    const rows = await this.functionalKnowledgeRepository.findActiveByTargetRef(
      projectId,
      functionalTargetRef(target),
    );

    return rows.map(toFunctionalRule);
  }
}
