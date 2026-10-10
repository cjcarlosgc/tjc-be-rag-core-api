import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AnalysisSymbol, Prisma, ScenarioKind } from '../../generated/prisma/client.js';

/**
 * WI-CORE-018 (DEC-FK-003/DEC-FK-004): construcción de comportamiento nueva o modificada de un
 * símbolo, persistida por el job de snapshot. Solo contiene lo necesario para preguntar.
 */
export type BehaviorConstructRecord = {
  scenarioKind: ScenarioKind;
  scenarioKey: string;
  order: number;
  snippet: string;
};

const BEHAVIOR_SCENARIO_KINDS: ReadonlySet<string> = new Set<ScenarioKind>([
  'EXPECTED_RESULT',
  'BOUNDARY',
  'EXCEPTION',
  'STATE_TRANSITION',
]);

export interface AnalysisSymbolToPersist {
  language: Prisma.AnalysisSymbolCreateManyInput['language'];
  kind: Prisma.AnalysisSymbolCreateManyInput['kind'];
  qualifiedName: string;
  filePath: string;
  changeKind: Prisma.AnalysisSymbolCreateManyInput['changeKind'];
  /** `undefined` o `null`: no calculado (PHP o Runs previos); la columna queda nula. */
  behaviorConstructs?: BehaviorConstructRecord[] | null;
}

/**
 * Lee la columna `behaviorConstructs`. Devuelve `null` cuando no hay valor calculado; descarta
 * entradas con forma inválida en vez de propagarlas a la elegibilidad.
 */
export function readBehaviorConstructs(value: AnalysisSymbol['behaviorConstructs']): BehaviorConstructRecord[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.flatMap((entry) => {
    const record = toBehaviorConstructRecord(entry);
    return record ? [record] : [];
  });
}

function toBehaviorConstructRecord(entry: unknown): BehaviorConstructRecord | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  const { scenarioKind, scenarioKey, order, snippet } = entry as Record<string, unknown>;
  if (
    typeof scenarioKind !== 'string' ||
    !BEHAVIOR_SCENARIO_KINDS.has(scenarioKind) ||
    typeof scenarioKey !== 'string' ||
    typeof order !== 'number' ||
    typeof snippet !== 'string'
  ) {
    return null;
  }

  return { scenarioKind: scenarioKind as ScenarioKind, scenarioKey, order, snippet };
}

@Injectable()
export class AnalysisSymbolsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertMany(analysisRunId: string, symbols: AnalysisSymbolToPersist[]): Promise<void> {
    if (symbols.length === 0) {
      return;
    }

    await this.prisma.analysisSymbol.createMany({
      data: symbols.map(({ behaviorConstructs, ...symbol }) => ({
        ...symbol,
        analysisRunId,
        ...(behaviorConstructs ? { behaviorConstructs } : {}),
      })),
    });
  }

  findByAnalysisRun(analysisRunId: string): Promise<AnalysisSymbol[]> {
    return this.prisma.analysisSymbol.findMany({ where: { analysisRunId } });
  }
}
