import { Injectable } from '@nestjs/common';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import { AnalysisSymbolsRepository } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import type { AnalysisRun, AnalysisSymbol } from '../generated/prisma/client.js';
import type { FunctionalScope } from '../generated/prisma/client.js';

export interface EvaluateFunctionalContextResult {
  actionRequired: boolean;
}

function symbolTargetRef(symbol: Pick<AnalysisSymbol, 'filePath' | 'qualifiedName'>): string {
  return `${symbol.filePath}::${symbol.qualifiedName}`;
}

function symbolScope(kind: AnalysisSymbol['kind']): FunctionalScope {
  return kind === 'METHOD' ? 'METHOD' : 'SYMBOL';
}

function buildQuestion(symbol: AnalysisSymbol): string {
  return `¿El comportamiento actual de "${symbol.qualifiedName}" (${symbol.filePath}) tras este cambio es el esperado, o hay una regla de negocio que deberíamos registrar?`;
}

function buildRationale(symbol: AnalysisSymbol): string {
  return `No existe conocimiento funcional ACTIVE registrado para "${symbol.qualifiedName}"; Core no puede confirmar si el comportamiento observado en este cambio es intencional sin una respuesta humana.`;
}

/**
 * HU35/36: decide si un Run tiene contexto funcional suficiente para seguir
 * (retrieval/generación, todavía no implementados) o necesita preguntar.
 * Compartido entre el job de snapshot intelligence (primera evaluación) y el
 * de continuation (reevaluación tras una respuesta) para no duplicar la
 * lógica ni re-materializar el snapshot.
 *
 * Simplificación documentada: una pregunta a la vez (adaptativa, sin total
 * fijo — `interoperability-contract.md` §6.11), sin generación de
 * pregunta/rationale vía LLM ni `visualAid` todavía (texto templado
 * determinístico, `visualAid` siempre null en la respuesta HTTP).
 */
@Injectable()
export class FunctionalContextEvaluatorService {
  constructor(
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly functionalQuestionsRepository: FunctionalQuestionsRepository,
    private readonly functionalKnowledgeRepository: FunctionalKnowledgeRepository,
  ) {}

  async evaluate(run: AnalysisRun): Promise<EvaluateFunctionalContextResult> {
    const symbols = await this.analysisSymbolsRepository.findByAnalysisRun(run.id);
    const candidates = symbols.filter(
      (symbol) =>
        symbol.changeKind === 'DIRECTLY_CHANGED' &&
        (symbol.kind === 'METHOD' || symbol.kind === 'FUNCTION'),
    );

    if (candidates.length === 0) {
      return { actionRequired: false };
    }

    const existingQuestions = await this.functionalQuestionsRepository.findByAnalysisRun(run.id);
    const alreadyTracked = new Set(
      existingQuestions
        .filter((question) => question.status !== 'OBSOLETE')
        .map((question) => `${question.filePath}::${question.qualifiedName}`),
    );

    for (const symbol of candidates) {
      const targetRef = symbolTargetRef(symbol);

      if (alreadyTracked.has(targetRef)) {
        continue;
      }

      const scope = symbolScope(symbol.kind);
      const covered = await this.functionalKnowledgeRepository.findActive(
        run.projectId,
        scope,
        targetRef,
      );

      if (covered) {
        continue;
      }

      await this.functionalQuestionsRepository.create({
        analysisRunId: run.id,
        projectId: run.projectId,
        symbolLanguage: symbol.language,
        symbolKind: symbol.kind,
        qualifiedName: symbol.qualifiedName,
        filePath: symbol.filePath,
        question: buildQuestion(symbol),
        rationale: buildRationale(symbol),
      });

      return { actionRequired: true };
    }

    return { actionRequired: false };
  }
}
