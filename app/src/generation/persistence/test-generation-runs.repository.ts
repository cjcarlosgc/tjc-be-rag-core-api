import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma, TargetRunResult, TestGenerationRun } from '../../generated/prisma/client.js';
import { TestRunStatus } from '../../generated/prisma/enums.js';
import type { GenerationMode } from '../dto/generation-mode.js';
import type { FailureTypeValue } from '../../sandbox/map-sandbox-result.js';

export type { FailureTypeValue };

export interface CreateTestGenerationRunInput {
  projectId: string;
  projectVersionId: string;
  mode: GenerationMode;
  targetId: string | null;
}

export interface TargetRunResultInput {
  targetId: string;
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: 'CLASS' | 'METHOD' | 'FUNCTION';
  testFilePath: string;
  status: 'VALID' | 'INVALID' | 'FAILED' | 'SKIPPED';
  compiled: boolean | null;
  executed: boolean | null;
  passed: boolean | null;
  valid: boolean | null;
  failureType: FailureTypeValue | null;
  errorSummary: string | null;
}

@Injectable()
export class TestGenerationRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateTestGenerationRunInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TestGenerationRun> {
    return (tx ?? this.prisma).testGenerationRun.create({ data: input });
  }

  findById(id: string): Promise<TestGenerationRun | null> {
    return this.prisma.testGenerationRun.findUnique({ where: { id } });
  }

  markStarted(id: string): Promise<TestGenerationRun> {
    return this.prisma.testGenerationRun.update({
      where: { id },
      data: { status: TestRunStatus.RESOLVING_TARGETS, startedAt: new Date() },
    });
  }

  setStatus(id: string, status: TestRunStatus): Promise<TestGenerationRun> {
    return this.prisma.testGenerationRun.update({ where: { id }, data: { status } });
  }

  update(id: string, data: Prisma.TestGenerationRunUpdateInput): Promise<TestGenerationRun> {
    return this.prisma.testGenerationRun.update({ where: { id }, data });
  }

  incrementProcessed(
    id: string,
    outcome: 'VALID' | 'INVALID' | 'FAILED' | 'SKIPPED',
  ): Promise<TestGenerationRun> {
    const data: Prisma.TestGenerationRunUpdateInput = { processedTargets: { increment: 1 } };

    if (outcome === 'VALID') {
      data.validTargets = { increment: 1 };
    } else if (outcome === 'INVALID') {
      data.invalidTargets = { increment: 1 };
    } else if (outcome === 'FAILED') {
      data.failedTargets = { increment: 1 };
    }

    return this.prisma.testGenerationRun.update({ where: { id }, data });
  }

  complete(
    id: string,
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED',
  ): Promise<TestGenerationRun> {
    return this.prisma.testGenerationRun.update({
      where: { id },
      data: { status, completedAt: new Date() },
    });
  }

  completeAsNoMissingTargets(id: string): Promise<TestGenerationRun> {
    return this.prisma.testGenerationRun.update({
      where: { id },
      data: {
        status: TestRunStatus.COMPLETED,
        totalTargets: 0,
        reason: 'NO_MISSING_TARGETS',
        completedAt: new Date(),
      },
    });
  }

  markFailed(id: string, failureCode: string, failureMessage: string): Promise<TestGenerationRun> {
    return this.prisma.testGenerationRun.update({
      where: { id },
      data: { status: TestRunStatus.FAILED, failureCode, failureMessage, completedAt: new Date() },
    });
  }

  insertTargetResult(testRunId: string, result: TargetRunResultInput): Promise<TargetRunResult> {
    return this.prisma.targetRunResult.create({ data: { testRunId, ...result } });
  }

  findTargetResults(testRunId: string): Promise<TargetRunResult[]> {
    return this.prisma.targetRunResult.findMany({
      where: { testRunId },
      orderBy: { createdAt: 'asc' },
    });
  }

  findTargetResult(testRunId: string, targetId: string): Promise<TargetRunResult | null> {
    return this.prisma.targetRunResult.findFirst({ where: { testRunId, targetId } });
  }

  updateTargetResult(
    id: string,
    data: Pick<
      TargetRunResultInput,
      'testFilePath' | 'status' | 'compiled' | 'executed' | 'passed' | 'valid' | 'failureType' | 'errorSummary'
    >,
  ): Promise<TargetRunResult> {
    return this.prisma.targetRunResult.update({ where: { id }, data });
  }

  /**
   * HU24 (reintento manual): mueve el target retryado de su bucket previo
   * (`invalidTargets`/`failedTargets`) al bucket del nuevo veredicto y
   * recalcula el `status` del run con la misma fórmula usada al cerrarlo la
   * primera vez. `previousStatus` solo puede ser `INVALID`/`FAILED` porque
   * son los únicos veredictos reintentables (ver `TestGenerationService`).
   */
  async applyRetryOutcome(
    testRunId: string,
    previousStatus: 'INVALID' | 'FAILED',
    newStatus: 'VALID' | 'INVALID' | 'FAILED',
  ): Promise<TestGenerationRun> {
    const decrementField = previousStatus === 'INVALID' ? 'invalidTargets' : 'failedTargets';
    const incrementField =
      newStatus === 'VALID' ? 'validTargets' : newStatus === 'INVALID' ? 'invalidTargets' : 'failedTargets';

    const run = await this.prisma.testGenerationRun.update({
      where: { id: testRunId },
      data:
        decrementField === incrementField
          ? {}
          : { [decrementField]: { decrement: 1 }, [incrementField]: { increment: 1 } },
    });

    const finalStatus =
      run.validTargets === run.totalTargets && (run.totalTargets ?? 0) > 0
        ? 'COMPLETED'
        : run.validTargets > 0 || run.invalidTargets > 0
          ? 'PARTIAL'
          : 'FAILED';

    return this.prisma.testGenerationRun.update({
      where: { id: testRunId },
      data: { status: finalStatus, completedAt: new Date() },
    });
  }

  /**
   * Página de runs de una ProjectVersion, más recientes primero. Se pide
   * `take + 1` para saber si hay una página siguiente sin una segunda
   * consulta; el cursor es el id del último run devuelto.
   */
  findByProjectVersion(
    projectVersionId: string,
    take: number,
    cursor?: string,
  ): Promise<TestGenerationRun[]> {
    return this.prisma.testGenerationRun.findMany({
      where: { projectVersionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
