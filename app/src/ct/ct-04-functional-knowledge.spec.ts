import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { FunctionalRulesRetriever } from '../retrieval/functional-rules.retriever.js';
import { FunctionalKnowledgeRepository } from '../functional-knowledge/functional-knowledge.repository.js';
import { FunctionalContextEvaluatorService } from '../functional-knowledge/functional-context-evaluator.service.js';
import { FunctionalContinuationJobHandler } from '../functional-knowledge/functional-continuation-job.handler.js';
import { FunctionalKnowledgeService } from '../functional-knowledge/functional-knowledge.service.js';
import { ANALYSIS_RUN_VALIDATION_JOB_TYPE } from '../validation/analysis-run-validation-job.handler.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  AnalysisRun,
  AnalysisSymbol,
  FunctionalKnowledge,
  FunctionalQuestion,
} from '../generated/prisma/client.js';
import type { RetrievalResult } from '../retrieval/retrieval.service.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';

/**
 * CT-04 (Functional Knowledge). Aserciones de este fichero:
 *  - CT-04-A2 (reformulada, declaración G-04/D-7): ninguna regla no ACTIVE llega a `functionalRules` del contexto.
 *    La parte «sin procedencia confirmada» NO se prueba ni se exige: en los Projects oficiales no existen reglas
 *    sin procedencia (las históricas con procedencia nula solo existen en el Project de desarrollo).
 *  - CT-04-A4: una regla requerida sin respuesta o en conflicto detiene el flujo con ACTION_REQUIRED y no genera.
 * CT-04-A5 (acceso con Postgres real) vive en `ct-04-access.pg.spec.ts`.
 */

const TARGET: RetrievalTarget = {
  filePath: 'src/thing.ts',
  symbolName: 'Thing',
  methodName: 'doIt',
  targetType: 'METHOD',
};
const TARGET_REF = 'src/thing.ts::Thing.doIt';
const PROJECT_ID = 'project-1';

function knowledgeRow(overrides: Partial<FunctionalKnowledge> = {}): FunctionalKnowledge {
  return {
    id: 'knowledge-active',
    projectId: PROJECT_ID,
    scope: 'METHOD',
    targetRef: TARGET_REF,
    originalQuestion: '¿Qué hace?',
    originalAnswer: 'sí',
    normalizedRule: 'Devuelve true cuando el valor es válido.',
    source: 'HUMAN_ANSWER',
    status: 'ACTIVE',
    supersedesId: null,
    confirmedByUserId: 'user-2',
    confirmedRole: 'ADMIN',
    originHeadSha: 'head-sha',
    sourceRef: null,
    scenarioKind: 'EXPECTED_RESULT',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  } as FunctionalKnowledge;
}

/**
 * Tabla en memoria detrás del `PrismaService` real del repositorio: `findMany` aplica el `where` que construye
 * el repositorio de producción (igualdad por clave). Así la exclusión de reglas no ACTIVE la decide el código
 * real (`findActiveByTargetRef`) y no el doble.
 */
function prismaOver(table: FunctionalKnowledge[]): PrismaService {
  const findMany = vi.fn(async (args: { where: Record<string, unknown>; orderBy?: unknown }) =>
    table
      .filter((row) =>
        Object.entries(args.where).every(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            throw new Error(`El doble solo soporta igualdad; el repositorio pidió ${key}: ${JSON.stringify(value)}`);
          }
          return (row as unknown as Record<string, unknown>)[key] === value;
        }),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)),
  );
  return { functionalKnowledge: { findMany } } as unknown as PrismaService;
}

const emptyRetrieval: RetrievalResult = { targetChunks: [], candidates: [] };

describe('CT-04 Functional Knowledge: contexto solo con reglas ACTIVE', () => {
  it('CT-04-A2: ninguna regla no ACTIVE (SUPERSEDED) llega a functionalRules del contexto (retriever + builder)', async () => {
    const table = [
      knowledgeRow({ id: 'k-superseded-old', status: 'SUPERSEDED', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      knowledgeRow({
        id: 'k-superseded-boundary',
        status: 'SUPERSEDED',
        scenarioKind: 'BOUNDARY',
        scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
      knowledgeRow({ id: 'k-active', supersedesId: 'k-superseded-old' }),
      // Ruido que no debe aparecer por otras razones: otro Project y otro target.
      knowledgeRow({ id: 'k-active-other-project', projectId: 'project-2' }),
      knowledgeRow({ id: 'k-active-other-target', targetRef: 'src/other.ts::Other.run' }),
    ];
    const retriever = new FunctionalRulesRetriever(new FunctionalKnowledgeRepository(prismaOver(table)));
    const builder = new ContextBuilder(new ConfigService());

    const retrieved = await retriever.retrieve(PROJECT_ID, TARGET);
    const context = builder.build(emptyRetrieval, TARGET, { framework: 'VITEST' }, {}, retrieved);

    expect(retrieved.map((rule) => rule.knowledgeId)).toEqual(['k-active']);
    expect(context.functionalRules.map((rule) => rule.knowledgeId)).toEqual(['k-active']);
    expect(context.audit?.functionalRules).toMatchObject({ retrieved: 1, selected: 1 });
    const serialized = JSON.stringify(context.functionalRules);
    expect(serialized).not.toContain('k-superseded');
  });

  it('CT-04-A2: con solo reglas SUPERSEDED el contexto no lleva reglas funcionales', async () => {
    const table = [knowledgeRow({ id: 'k-superseded', status: 'SUPERSEDED' })];
    const retriever = new FunctionalRulesRetriever(new FunctionalKnowledgeRepository(prismaOver(table)));
    const builder = new ContextBuilder(new ConfigService());

    const retrieved = await retriever.retrieve(PROJECT_ID, TARGET);
    const context = builder.build(emptyRetrieval, TARGET, { framework: 'VITEST' }, {}, retrieved);

    expect(context.functionalRules).toEqual([]);
    expect(context.audit?.functionalRules).toMatchObject({ retrieved: 0, selected: 0 });
  });
});

const RUN = { id: 'run-1', projectId: PROJECT_ID, status: 'PROCESSING', current: true } as AnalysisRun;
const CONSTRUCT = {
  scenarioKind: 'EXPECTED_RESULT',
  scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
  order: 0,
  snippet: 'if (amount <= 0)',
};
const CHANGED_SYMBOL = {
  id: 'symbol-1',
  analysisRunId: 'run-1',
  language: 'TYPESCRIPT',
  kind: 'METHOD',
  qualifiedName: 'Thing.doIt',
  filePath: 'src/thing.ts',
  changeKind: 'DIRECTLY_CHANGED',
  behaviorConstructs: [CONSTRUCT],
  createdAt: new Date(),
} as unknown as AnalysisSymbol;

/** Continuación real (handler + evaluador) con dobles solo en los bordes: persistencia, cola y publicación. */
function continuation(activeRule: FunctionalKnowledge | null) {
  const askedRun = { ...RUN, status: 'ACTION_REQUIRED' } as AnalysisRun;
  const questionsRepository = {
    findByAnalysisRun: vi.fn().mockResolvedValue([] as FunctionalQuestion[]),
    createForCurrentRun: vi.fn().mockResolvedValue({ question: {} as FunctionalQuestion, analysisRun: askedRun }),
  };
  const knowledgeRepository = { findActive: vi.fn().mockResolvedValue(activeRule) };
  const evaluator = new FunctionalContextEvaluatorService(
    { findByAnalysisRun: vi.fn().mockResolvedValue([CHANGED_SYMBOL]) } as never,
    questionsRepository as never,
    knowledgeRepository as never,
    { findById: vi.fn().mockResolvedValue(null) } as never,
    { runChanged: vi.fn().mockResolvedValue(undefined) } as never,
  );
  const jobs = { registerHandler: vi.fn(), enqueue: vi.fn() };
  const checks = { publishForRun: vi.fn().mockResolvedValue(undefined) };
  const handler = new FunctionalContinuationJobHandler(
    jobs as never,
    { findById: vi.fn().mockResolvedValue(RUN) } as never,
    evaluator,
    checks as never,
  );

  return { handler, jobs, checks, questionsRepository, askedRun };
}

describe('CT-04 Functional Knowledge: regla requerida sin respuesta o en conflicto', () => {
  it('CT-04-A4: sin regla ACTIVE para una construcción requerida el Run queda en ACTION_REQUIRED y no se encola la generación', async () => {
    const { handler, jobs, checks, questionsRepository, askedRun } = continuation(null);

    await handler.handle({ analysisRunId: 'run-1' });

    expect(questionsRepository.createForCurrentRun).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioKey: CONSTRUCT.scenarioKey, qualifiedName: 'Thing.doIt', filePath: 'src/thing.ts' }),
      'PROCESSING',
    );
    expect(checks.publishForRun).toHaveBeenCalledWith(askedRun);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('CT-04-A4: con la regla ACTIVE de esa construcción el flujo sí continúa hacia la generación (contraste)', async () => {
    const { handler, jobs, checks, questionsRepository } = continuation(knowledgeRow());

    await handler.handle({ analysisRunId: 'run-1' });

    expect(questionsRepository.createForCurrentRun).not.toHaveBeenCalled();
    expect(checks.publishForRun).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith(ANALYSIS_RUN_VALIDATION_JOB_TYPE, { analysisRunId: 'run-1' });
  });

  it('CT-04-A4: una respuesta en conflicto con una regla ACTIVE se rechaza con 409, no escribe reglas ni continúa el Run', async () => {
    const run = { id: 'run-1', projectId: PROJECT_ID, status: 'ACTION_REQUIRED', current: true, headSha: 'head-sha' } as AnalysisRun;
    const question = {
      id: 'question-1',
      analysisRunId: 'run-1',
      projectId: PROJECT_ID,
      symbolLanguage: 'TYPESCRIPT',
      symbolKind: 'METHOD',
      qualifiedName: 'Thing.doIt',
      filePath: 'src/thing.ts',
      question: '¿...?',
      status: 'PENDING',
      scenarioKind: 'EXPECTED_RESULT',
      scenarioKey: CONSTRUCT.scenarioKey,
    } as unknown as FunctionalQuestion;
    const questionsRepository = {
      findById: vi.fn().mockResolvedValue({ ...question, abstentions: [] }),
      answer: vi.fn(),
      markObsolete: vi.fn(),
      recordAbstention: vi.fn(),
    };
    const knowledgeRepository = {
      findActive: vi.fn().mockResolvedValue(knowledgeRow()),
      create: vi.fn(),
      supersede: vi.fn(),
    };
    const evaluator = { evaluate: vi.fn() };
    const runsService = { requestContinuation: vi.fn() };
    const jobs = { enqueue: vi.fn() };
    const service = new FunctionalKnowledgeService(
      questionsRepository as never,
      knowledgeRepository as never,
      evaluator as never,
      { findByIdForOwner: vi.fn().mockResolvedValue(run) } as never,
      runsService as never,
      { require: vi.fn().mockResolvedValue({ project: { id: PROJECT_ID }, role: 'MAINTAINER' }) } as never,
      jobs as never,
      { get: vi.fn().mockReturnValue(1500) } as never,
    );

    await expect(
      service.submitAnswer('run-1', 'question-1', { choice: 'NO', answer: 'no, cambió' }, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT });

    expect(knowledgeRepository.create).not.toHaveBeenCalled();
    expect(knowledgeRepository.supersede).not.toHaveBeenCalled();
    expect(questionsRepository.answer).not.toHaveBeenCalled();
    expect(runsService.requestContinuation).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
