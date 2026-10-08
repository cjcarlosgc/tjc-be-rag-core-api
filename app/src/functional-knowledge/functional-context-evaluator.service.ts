import { Injectable } from '@nestjs/common';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import {
  AnalysisSymbolsRepository,
  readBehaviorConstructs,
  type BehaviorConstructRecord,
} from '../analysis-runs/persistence/analysis-symbols.repository.js';
import type { AnalysisRun, AnalysisSymbol, FunctionalScope } from '../generated/prisma/client.js';

export type EvaluateFunctionalContextResult =
  | { actionRequired: false }
  | { actionRequired: true; analysisRun: AnalysisRun };

interface BehaviorTarget {
  symbol: AnalysisSymbol;
  constructs: BehaviorConstructRecord[];
}

function symbolTargetRef(symbol: Pick<AnalysisSymbol, 'filePath' | 'qualifiedName'>): string {
  return `${symbol.filePath}::${symbol.qualifiedName}`;
}

function symbolScope(kind: AnalysisSymbol['kind']): FunctionalScope {
  return kind === 'METHOD' ? 'METHOD' : 'SYMBOL';
}

/**
 * DEC-FK-003: solo una función o método TypeScript `DIRECTLY_CHANGED` puede generar preguntas, y
 * únicamente si el job de snapshot persistió construcciones nuevas o modificadas.
 */
function isBehaviorTarget(symbol: AnalysisSymbol): boolean {
  return (
    symbol.language === 'TYPESCRIPT' &&
    symbol.changeKind === 'DIRECTLY_CHANGED' &&
    (symbol.kind === 'METHOD' || symbol.kind === 'FUNCTION')
  );
}

function compareStable(left: BehaviorTarget, right: BehaviorTarget): number {
  if (left.symbol.filePath !== right.symbol.filePath) {
    return left.symbol.filePath < right.symbol.filePath ? -1 : 1;
  }
  if (left.symbol.qualifiedName !== right.symbol.qualifiedName) {
    return left.symbol.qualifiedName < right.symbol.qualifiedName ? -1 : 1;
  }
  return 0;
}

function buildQuestion(symbol: AnalysisSymbol, construct: BehaviorConstructRecord): string {
  const subject = `"${symbol.qualifiedName}" (${symbol.filePath})`;
  const snippet = `"${construct.snippet}"`;

  switch (construct.scenarioKind) {
    case 'BOUNDARY':
      return `¿Cuál es el comportamiento esperado de ${subject} en el límite de esta condición: ${snippet}?`;
    case 'EXCEPTION':
      return `¿Es esperado que ${subject} lance en este caso: ${snippet}? Si es así, ¿en qué condición debe ocurrir?`;
    case 'STATE_TRANSITION':
      return `¿Es esperado el cambio de estado que realiza ${subject} en este código: ${snippet}?`;
    case 'EXPECTED_RESULT':
    default:
      return `¿Cuál es el resultado esperado de ${subject} en este caso del código: ${snippet}?`;
  }
}

function buildRationale(symbol: AnalysisSymbol, construct: BehaviorConstructRecord): string {
  return `Core detectó una construcción de comportamiento nueva o modificada (${construct.scenarioKind}) en "${symbol.qualifiedName}" (${symbol.filePath}) sin regla ACTIVE aplicable; no puede confirmar el resultado esperado sin una respuesta funcional.`;
}

/**
 * HU35/36 y WI-CORE-018 (DEC-FK-003): decide si un Run tiene contexto funcional suficiente para
 * seguir o necesita preguntar. Solo lee `analysis_symbols.behaviorConstructs`, calculado por el job
 * de snapshot con el HEAD en disco; no hace I/O de GitHub ni de disco.
 *
 * Elegibilidad: una pregunta por construcción nueva o modificada de un target `DIRECTLY_CHANGED`
 * `METHOD`/`FUNCTION` TypeScript, sin regla `ACTIVE` del target (hasta WI-CORE-020) y sin pregunta
 * no `OBSOLETE` con la misma `scenarioKey`. Una pregunta histórica (`scenarioKey` nulo) cubre todo
 * el target. Las preguntas se plantean de una en una, en orden estable (archivo, nombre, `order`).
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
    const targets = symbols
      .filter(isBehaviorTarget)
      .map((symbol) => ({ symbol, constructs: readBehaviorConstructs(symbol.behaviorConstructs) ?? [] }))
      .filter((target) => target.constructs.length > 0)
      .sort(compareStable);

    if (targets.length === 0) {
      return { actionRequired: false };
    }

    const questions = (await this.functionalQuestionsRepository.findByAnalysisRun(run.id)).filter(
      (question) => question.status !== 'OBSOLETE',
    );

    for (const { symbol, constructs } of targets) {
      const targetQuestions = questions.filter(
        (question) => question.filePath === symbol.filePath && question.qualifiedName === symbol.qualifiedName,
      );

      // Una pregunta histórica (sin scenarioKey) cubre todo el target.
      if (targetQuestions.some((question) => question.scenarioKey === null)) {
        continue;
      }

      const trackedKeys = new Set(targetQuestions.map((question) => question.scenarioKey));
      const pending = [...constructs]
        .sort((left, right) => left.order - right.order)
        .find((construct) => !trackedKeys.has(construct.scenarioKey));

      if (!pending) {
        continue;
      }

      const targetRef = symbolTargetRef(symbol);
      const covered = await this.functionalKnowledgeRepository.findActive(
        run.projectId,
        symbolScope(symbol.kind),
        targetRef,
      );

      if (covered) {
        continue;
      }

      const result = await this.functionalQuestionsRepository.createForCurrentRun({
        analysisRunId: run.id,
        projectId: run.projectId,
        symbolLanguage: symbol.language,
        symbolKind: symbol.kind,
        qualifiedName: symbol.qualifiedName,
        filePath: symbol.filePath,
        question: buildQuestion(symbol, pending),
        rationale: buildRationale(symbol, pending),
        scenarioKind: pending.scenarioKind,
        scenarioKey: pending.scenarioKey,
      }, run.status);

      if (!result) {
        return { actionRequired: false };
      }

      return { actionRequired: true, analysisRun: result.analysisRun };
    }

    return { actionRequired: false };
  }
}
