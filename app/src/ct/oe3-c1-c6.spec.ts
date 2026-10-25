import { describe, expect, it, vi } from 'vitest';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
import { InMemoryPrisma } from '../../test/support/in-memory-prisma.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { FunctionalContextEvaluatorService } from '../functional-knowledge/functional-context-evaluator.service.js';
import {
  FUNCTIONAL_CONTINUATION_JOB_TYPE,
  FunctionalContinuationJobHandler,
} from '../functional-knowledge/functional-continuation-job.handler.js';
import { FunctionalKnowledgeRepository } from '../functional-knowledge/functional-knowledge.repository.js';
import { FunctionalKnowledgeService } from '../functional-knowledge/functional-knowledge.service.js';
import { FunctionalQuestionsRepository } from '../functional-knowledge/functional-questions.repository.js';
import { OrganizationAccessResolver } from '../project-access/organization-access.resolver.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { ANALYSIS_RUN_VALIDATION_JOB_TYPE } from '../validation/analysis-run-validation-job.handler.js';
import { toFunctionalKnowledgeResponse } from '../functional-knowledge/dto/functional-knowledge.response.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AnalysisRun, AnalysisSymbol, FunctionalKnowledge, FunctionalQuestion } from '../generated/prisma/client.js';

/**
 * OE3 (tesis, Anexo I): casos C1–C6 de la Tabla 62 y campos de auditoría de la Tabla 63, ejecutados de extremo
 * a extremo del mecanismo con el código REAL: evaluador de contexto, `FunctionalKnowledgeService`, repositorios
 * de preguntas y reglas, manejador de continuación y `ProjectAccessService` (mapeo permiso de GitHub -> rol).
 *
 * Dobles solo en los bordes: Prisma (tablas en memoria con `InMemoryPrisma`), GitHub (`FakeGithubAccessPort`), la
 * cola de jobs, la publicación del check, el realtime, los símbolos persistidos por el snapshot y la transición
 * `ACTION_REQUIRED -> PROCESSING` de `AnalysisRunsService` (su propio spec la cubre).
 *
 * La tabla en memoria de reglas replica el índice único parcial ACTIVE solo para poder ejercitar la rama de carrera
 * del servicio; el índice real y la atomicidad de `supersede` se prueban con Postgres en `oe3-active-index.pg.spec.ts`.
 *
 * No duplica los matices ya cubiertos por `functional-knowledge.service.spec.ts`, `functional-context-evaluator
 * .service.spec.ts`, `functional-continuation-job.handler.spec.ts`, `functional-knowledge.repository.spec.ts` y
 * `ct-04-functional-knowledge.spec.ts`: aquí cada caso de la Tabla 62 queda nombrado y demostrado como conjunto.
 * Identificadores de evidencia: los títulos `OE3-C1` … `OE3-C6` y `OE3-Tabla63`.
 */

const PROJECT_ID = 'project-1';
const TARGET_REF = 'src/thing.ts::Thing.doIt';
const KEY_A = 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa';
const KEY_B = 'BOUNDARY:bbbbbbbbbbbbbbbb';
const ORG_ID = '42';
const ORG_LOGIN = 'acme';
const REPO = 'acme/widgets';

type Delegate = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
type Row = Record<string, unknown>;

/** Usuarios de la organización: cada uno con el permiso de GitHub que deriva su rol de Project. */
const USERS = {
  owner: { id: 'u-owner', github: '1001', role: 'ADMIN' as const },
  maintainer: { id: 'u-maintain', github: '1002', permission: 'maintain' as const, role: 'MAINTAINER' as const },
  adminPermission: { id: 'u-admin-perm', github: '1003', permission: 'admin' as const, role: 'MAINTAINER' as const },
  writer: { id: 'u-write', github: '1004', permission: 'write' as const, role: 'WRITER' as const },
  triage: { id: 'u-triage', github: '1005', permission: 'triage' as const, role: 'READER' as const },
  reader: { id: 'u-read', github: '1006', permission: 'read' as const, role: 'READER' as const },
};

interface SymbolSpec {
  kind?: AnalysisSymbol['kind'];
  language?: AnalysisSymbol['language'];
  changeKind?: AnalysisSymbol['changeKind'];
  qualifiedName?: string;
  filePath?: string;
  constructs?: Array<{ scenarioKind: string; scenarioKey: string; snippet: string }> | null;
}

function symbol(spec: SymbolSpec = {}): AnalysisSymbol {
  const constructs = spec.constructs === undefined ? [{ scenarioKind: 'EXPECTED_RESULT', scenarioKey: KEY_A, snippet: 'if (amount <= 0)' }] : spec.constructs;

  return {
    id: `symbol-${spec.qualifiedName ?? 'Thing.doIt'}`,
    analysisRunId: 'run',
    language: spec.language ?? 'TYPESCRIPT',
    kind: spec.kind ?? 'METHOD',
    qualifiedName: spec.qualifiedName ?? 'Thing.doIt',
    filePath: spec.filePath ?? 'src/thing.ts',
    changeKind: spec.changeKind ?? 'DIRECTLY_CHANGED',
    behaviorConstructs: constructs === null ? null : constructs.map((construct, order) => ({ ...construct, order })),
    createdAt: new Date(),
  } as unknown as AnalysisSymbol;
}

const BOUNDARY_CONSTRUCT = { scenarioKind: 'BOUNDARY', scenarioKey: KEY_B, snippet: 'amount === 0' };

function makeHarness() {
  const db = new InMemoryPrisma();
  let tick = 0;
  const nextTime = () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000);

  // Reglas: valores por defecto de la base y réplica del índice único parcial ACTIVE (solo para la rama de carrera).
  const knowledgeBase = db.functionalKnowledge as Delegate;
  db.functionalKnowledge = {
    ...knowledgeBase,
    create: async ({ data }: { data?: Row } & Row) => {
      const input = data as Row;
      const sameKey = (row: Row) =>
        row.status === 'ACTIVE' &&
        row.projectId === input.projectId &&
        row.scope === input.scope &&
        (row.targetRef ?? '') === (input.targetRef ?? '') &&
        row.scenarioKey === input.scenarioKey;

      if ((input.status ?? 'ACTIVE') === 'ACTIVE' && db.tables.functionalKnowledge.some(sameKey)) {
        throw Object.assign(new Error('Unique constraint failed on functional_knowledge_active_scenario_key'), { code: 'P2002' });
      }

      return knowledgeBase.create({
        data: {
          source: 'HUMAN_ANSWER',
          status: 'ACTIVE',
          supersedesId: null,
          confirmedByUserId: null,
          confirmedRole: null,
          originHeadSha: null,
          sourceRef: null,
          createdAt: nextTime(),
          ...input,
        },
      });
    },
  };

  // Abstenciones: tabla y delegado mínimos; la pregunta las incluye ordenadas de la más reciente a la más antigua.
  db.tables.functionalQuestionAbstention = [];
  const abstentionsOf = (questionId: unknown) =>
    db.tables.functionalQuestionAbstention
      .filter((row) => row.questionId === questionId)
      .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || String(b.id).localeCompare(String(a.id)));
  db.functionalQuestionAbstention = {
    create: async ({ data }: { data?: Row } & Row) => db.insert('functionalQuestionAbstention', { ...(data as Row), createdAt: nextTime() }),
    findMany: async ({ where }: { where?: Row } & Row) => abstentionsOf((where as Row).questionId),
  };
  const questionBase = db.functionalQuestion as Delegate;
  const withAbstentions = async (found: unknown) =>
    found ? { ...(found as Row), abstentions: abstentionsOf((found as Row).id) } : found;
  db.functionalQuestion = {
    ...questionBase,
    // Valores por defecto de la base que la tabla en memoria no aplica.
    create: async ({ data }: { data?: Row } & Row) =>
      questionBase.create({
        data: {
          status: 'PENDING',
          answerChoice: null,
          answerText: null,
          knowledgeId: null,
          answeredAt: null,
          createdAt: nextTime(),
          ...(data as Row),
        },
      }),
    findFirst: async (args: Row) => withAbstentions(await questionBase.findFirst(args)),
    findUnique: async (args: Row) => withAbstentions(await questionBase.findUnique(args)),
  };

  // El incremento de `actionRequiredCount` es un contador que la tabla en memoria no interpreta.
  const runBase = db.analysisRun as Delegate;
  db.analysisRun = {
    ...runBase,
    updateMany: async ({ where, data }: { where?: Row; data?: Row } & Row) => {
      const { actionRequiredCount, ...rest } = data as Row;
      const updated = (await runBase.updateMany({ where, data: rest })) as { count: number };
      if (actionRequiredCount && updated.count > 0) {
        for (const row of db.tables.analysisRun.filter((candidate) => candidate.id === (where as Row).id)) {
          row.actionRequiredCount = Number(row.actionRequiredCount ?? 0) + 1;
        }
      }
      return updated;
    },
  };

  // Acceso: organización con un owner y miembros con distintos permisos sobre el repositorio vinculado.
  db.insert('project', { id: PROJECT_ID, name: PROJECT_ID, ownerUserId: USERS.owner.id, githubOrgId: ORG_ID, githubOrgLogin: ORG_LOGIN });
  db.insert('repositoryBinding', { projectId: PROJECT_ID, status: 'ENABLED', repositoryName: REPO, installationId: 'inst-42' });
  const github = new FakeGithubAccessPort();
  github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG_LOGIN, avatarUrl: null, suspended: false });
  const identities = new Map<string, string>();
  for (const user of Object.values(USERS)) {
    identities.set(user.id, user.github);
    github.setMembership(ORG_LOGIN, user.github, { role: user === USERS.owner ? 'admin' : 'member', state: 'active' });
    if ('permission' in user) {
      github.setPermission(REPO, user.github, user.permission);
    }
  }
  const projectAccess = new ProjectAccessService(
    new ProjectAccessRepository(db as unknown as PrismaService),
    new OrganizationAccessResolver(github),
    { resolve: (userId: string) => Promise.resolve(identities.get(userId) as string) } as never,
    github,
  );

  // Núcleo real.
  const prisma = db as unknown as PrismaService;
  const questionsRepository = new FunctionalQuestionsRepository(prisma);
  const knowledgeRepository = new FunctionalKnowledgeRepository(prisma);
  const symbols: AnalysisSymbol[] = [symbol()];
  const evaluator = new FunctionalContextEvaluatorService(
    { findByAnalysisRun: async () => symbols } as never,
    questionsRepository,
    knowledgeRepository,
    { findById: async () => null } as never,
    { runChanged: async () => undefined } as never,
  );
  const jobs = { registerHandler: vi.fn(), enqueue: vi.fn().mockResolvedValue(undefined) };
  const runRow = (id: string) => db.tables.analysisRun.find((row) => row.id === id) as unknown as AnalysisRun | undefined;
  const requestContinuation = vi.fn(async (runId: string) => {
    const row = db.tables.analysisRun.find((candidate) => candidate.id === runId) as Row;
    Object.assign(row, { status: 'PROCESSING', attemptCount: Number(row.attemptCount ?? 0) + 1 });
    return row as unknown as AnalysisRun;
  });
  const service = new FunctionalKnowledgeService(
    questionsRepository,
    knowledgeRepository,
    evaluator,
    { findByIdForOwner: async (id: string) => runRow(id) ?? null } as never,
    { requestContinuation } as never,
    projectAccess,
    jobs as never,
    { get: () => 1500 } as never,
  );
  const checks = { publishForRun: vi.fn().mockResolvedValue(undefined) };
  const handler = new FunctionalContinuationJobHandler(
    jobs as never,
    { findById: async (id: string) => runRow(id) ?? null } as never,
    evaluator,
    checks as never,
  );

  const harness = {
    db,
    github,
    projectAccess,
    service,
    handler,
    jobs,
    checks,
    requestContinuation,
    knowledgeRepository,
    evaluator,
    symbols,
    runRow,
    knowledge: () => db.tables.functionalKnowledge as unknown as FunctionalKnowledge[],
    questions: () => db.tables.functionalQuestion as unknown as FunctionalQuestion[],
    abstentions: () => db.tables.functionalQuestionAbstention,
    question: (id: string) => harness.questions().find((candidate) => candidate.id === id) as FunctionalQuestion,
    newRun: (headSha: string, overrides: Row = {}): AnalysisRun =>
      db.insert('analysisRun', {
        projectId: PROJECT_ID,
        repositoryName: REPO,
        prNumber: 7,
        headSha,
        status: 'PROCESSING',
        current: true,
        functionalBehaviorValidated: false,
        attemptCount: 0,
        actionRequiredCount: 0,
        pullRequestCreatedAt: new Date(),
        repositoryBindingEligible: true,
        ...overrides,
      }) as unknown as AnalysisRun,
    /** Evalúa un Run PROCESSING con el evaluador real; devuelve el resultado y la pregunta PENDING creada, si la hay. */
    ask: async (run: AnalysisRun) => {
      const result = await evaluator.evaluate(harness.runRow(run.id) as AnalysisRun);
      const pending = harness.questions().filter((candidate) => candidate.analysisRunId === run.id && candidate.status === 'PENDING');
      return { result, pending };
    },
    /** Run nuevo con su primera pregunta ya planteada (ACTION_REQUIRED). */
    askedRun: async (headSha = 'head-1') => {
      const run = harness.newRun(headSha);
      const { pending } = await harness.ask(run);
      expect(pending).toHaveLength(1);
      return { run, question: pending[0] };
    },
  };

  return harness;
}

type Harness = ReturnType<typeof makeHarness>;

function active(h: Harness, scenarioKey = KEY_A, targetRef = TARGET_REF) {
  return h.knowledge().filter((row) => row.status === 'ACTIVE' && row.scenarioKey === scenarioKey && row.targetRef === targetRef);
}

describe('OE3-C1: ACTION_REQUIRED solo ante incertidumbre funcional elegible del target', () => {
  it.each([
    ['TYPESCRIPT', 'src/thing.ts', 'Thing.doIt'],
    ['PHP', 'src/Money.php', 'Money::add'],
  ] as const)(
    'OE3-C1: un método %s DIRECTLY_CHANGED con construcciones nuevas y sin regla ACTIVE detiene el Run en ACTION_REQUIRED con una pregunta PENDING del target',
    async (language, filePath, qualifiedName) => {
      const h = makeHarness();
      h.symbols.splice(0, h.symbols.length, symbol({ language, filePath, qualifiedName }));
      const run = h.newRun('head-1');

      const { result, pending } = await h.ask(run);

      expect(result).toMatchObject({ actionRequired: true });
      expect(h.runRow(run.id)?.status).toBe('ACTION_REQUIRED');
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ filePath, qualifiedName, scenarioKey: KEY_A, projectId: PROJECT_ID, status: 'PENDING' });
      expect(h.knowledge()).toEqual([]);
    },
  );

  it.each([
    ['cambio sin construcciones nuevas o modificadas (lista vacía)', [symbol({ constructs: [] })]],
    ['cambio sin construcciones calculadas (null)', [symbol({ constructs: null })]],
    [
      'un cambio solo de clase e interfaz (símbolos no METHOD/FUNCTION), aunque el cambio sea amplio',
      [symbol({ kind: 'CLASS', qualifiedName: 'Thing' }), symbol({ kind: 'INTERFACE', qualifiedName: 'IThing' })],
    ],
    ['un método solo impactado (no cambiado directamente)', [symbol({ changeKind: 'POTENTIALLY_IMPACTED' })]],
    ['símbolo de un archivo de test, aunque tenga construcciones', [symbol({ filePath: 'tests/thing.spec.ts', qualifiedName: 'thing.spec' })]],
  ])('OE3-C1: NO se activa por %s', async (_label, symbols) => {
    const h = makeHarness();
    h.symbols.splice(0, h.symbols.length, ...(symbols as AnalysisSymbol[]));
    const run = h.newRun('head-1');

    const { result, pending } = await h.ask(run);

    expect(result).toEqual({ actionRequired: false });
    expect(pending).toEqual([]);
    expect(h.questions()).toEqual([]);
    expect(h.runRow(run.id)?.status).toBe('PROCESSING');
  });

  it('OE3-C1: NO se activa si ya existe una regla ACTIVE aplicable (misma clave de escenario) del target', async () => {
    const h = makeHarness();
    const first = await h.askedRun('head-1');
    await h.service.submitAnswer(first.run.id, first.question.id, { choice: 'YES', answer: 'devuelve 0' }, USERS.maintainer.id);
    const nextRun = h.newRun('head-2');

    const { result, pending } = await h.ask(nextRun);

    expect(result).toEqual({ actionRequired: false });
    expect(pending).toEqual([]);
    expect(h.runRow(nextRun.id)?.status).toBe('PROCESSING');
  });

  it.each([
    ['otro target con la misma clave', { targetRef: 'src/other.ts::Other.run' }],
    ['otro Project con el mismo target y la misma clave', { projectId: 'otro-project' }],
    ['otro alcance (scope SYMBOL en lugar de METHOD) con el mismo target y la misma clave', { scope: 'SYMBOL' }],
  ])('OE3-C1: una regla ACTIVE de %s NO cubre la construcción: sigue siendo incertidumbre elegible', async (_label, override) => {
    const h = makeHarness();
    h.db.insert('functionalKnowledge', {
      projectId: PROJECT_ID, scope: 'METHOD', targetRef: TARGET_REF, originalQuestion: 'q', originalAnswer: 'a',
      normalizedRule: 'a', source: 'HUMAN_ANSWER', status: 'ACTIVE', supersedesId: null, scenarioKind: 'EXPECTED_RESULT', scenarioKey: KEY_A,
      ...override,
    });
    const run = h.newRun('head-1');

    const { result, pending } = await h.ask(run);

    expect(result).toMatchObject({ actionRequired: true });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ scenarioKey: KEY_A, projectId: PROJECT_ID, status: 'PENDING' });
  });

  it('OE3-C1: una regla ACTIVE de otra clave de escenario NO cubre la construcción: sigue siendo incertidumbre elegible', async () => {
    const h = makeHarness();
    h.symbols.splice(0, h.symbols.length, symbol({ constructs: [{ scenarioKind: 'EXPECTED_RESULT', scenarioKey: KEY_A, snippet: 'a' }, BOUNDARY_CONSTRUCT] }));
    const first = await h.askedRun('head-1');
    await h.service.submitAnswer(first.run.id, first.question.id, { choice: 'YES', answer: 'regla A' }, USERS.maintainer.id);
    const nextRun = h.newRun('head-2');

    const { pending } = await h.ask(nextRun);

    // KEY_A está cubierta por la regla ACTIVE; solo se pregunta la construcción B (pregunta única, orden estable).
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ scenarioKey: KEY_B });
  });

  it('OE3-C1: con varios símbolos solo el elegible genera la pregunta (una a la vez)', async () => {
    const h = makeHarness();
    h.symbols.splice(
      0,
      h.symbols.length,
      symbol({ qualifiedName: 'Thing.untouched', constructs: [] }),
      symbol({ kind: 'CLASS', qualifiedName: 'Thing' }),
      symbol({ qualifiedName: 'Thing.doIt' }),
    );
    const run = h.newRun('head-1');

    const { pending } = await h.ask(run);

    expect(h.questions()).toHaveLength(1);
    expect(pending[0]).toMatchObject({ qualifiedName: 'Thing.doIt' });
  });
});

describe('OE3-C2: respuesta confirmada por MAINTAINER/ADMIN crea FK y permite continuación con HEAD vigente', () => {
  it.each([
    ['MAINTAINER', USERS.maintainer],
    ['ADMIN', USERS.owner],
  ] as const)(
    'OE3-C2: la respuesta de un %s crea la FK ACTIVE, responde la pregunta y continúa el Run hasta la generación con el HEAD vigente',
    async (role, user) => {
      const h = makeHarness();
      const { run, question } = await h.askedRun('head-vigente');

      const accepted = await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0 cuando amount <= 0' }, user.id);

      const rules = active(h);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ confirmedRole: role, confirmedByUserId: user.id, originHeadSha: 'head-vigente', source: 'HUMAN_ANSWER' });
      expect(accepted).toMatchObject({ outcome: 'ANSWERED', knowledgeId: rules[0].id, questionId: question.id, analysisRunId: run.id });
      expect(accepted.continuationAttemptId).toEqual(expect.any(String));
      expect(h.question(question.id)).toMatchObject({ status: 'ANSWERED', answerChoice: 'YES', knowledgeId: rules[0].id });
      expect(h.requestContinuation).toHaveBeenCalledWith(run.id, user.id);
      expect(h.jobs.enqueue).toHaveBeenCalledWith(FUNCTIONAL_CONTINUATION_JOB_TYPE, { analysisRunId: run.id });

      // Continuación real: con la regla ACTIVE el Run ya no pide contexto y se encola la validación/generación.
      h.jobs.enqueue.mockClear();
      await h.handler.handle({ analysisRunId: run.id });

      expect(h.jobs.enqueue).toHaveBeenCalledTimes(1);
      expect(h.jobs.enqueue).toHaveBeenCalledWith(ANALYSIS_RUN_VALIDATION_JOB_TYPE, { analysisRunId: run.id });
      expect(h.checks.publishForRun).not.toHaveBeenCalled();
      expect(h.questions().filter((candidate) => candidate.status === 'PENDING')).toEqual([]);
    },
  );

  it('OE3-C2: con otra construcción aún sin regla, la respuesta crea la FK pero el Run vuelve a ACTION_REQUIRED en la continuación (no genera)', async () => {
    const h = makeHarness();
    h.symbols.splice(0, h.symbols.length, symbol({ constructs: [{ scenarioKind: 'EXPECTED_RESULT', scenarioKey: KEY_A, snippet: 'a' }, BOUNDARY_CONSTRUCT] }));
    const { run, question } = await h.askedRun('head-1');

    const accepted = await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'regla A' }, USERS.maintainer.id);

    expect(accepted.knowledgeId).toEqual(expect.any(String));
    // Hay otra construcción sin regla: la propia respuesta ya evalúa y NO encola continuación.
    expect(h.requestContinuation).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
    expect(accepted.continuationAttemptId).toBeNull();
    expect(h.questions().filter((candidate) => candidate.status === 'PENDING')).toMatchObject([{ scenarioKey: KEY_B }]);
  });

  it.each([
    ['el HEAD ya no es el vigente (current = false)', { current: false }],
    ['el Run ya no está en ACTION_REQUIRED (OBSOLETE)', { status: 'OBSOLETE', current: false }],
  ])('OE3-C2: con HEAD obsoleto (%s) la pregunta pasa a OBSOLETE, no se crea FK ni se continúa', async (_label, staleness) => {
    const h = makeHarness();
    const { run, question } = await h.askedRun('head-viejo');
    Object.assign(h.runRow(run.id) as object, staleness);

    await expect(
      h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0' }, USERS.maintainer.id),
    ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND, status: 404 });

    expect(h.question(question.id).status).toBe('OBSOLETE');
    expect(h.knowledge()).toEqual([]);
    expect(h.requestContinuation).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).not.toHaveBeenCalled();

    // Aunque llegara un job de continuación para ese Run, el manejador no lo reanuda.
    await h.handler.handle({ analysisRunId: run.id });
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('OE3-C2: al consultar la pregunta de un Run con HEAD obsoleto no se ofrece y queda OBSOLETE', async () => {
    const h = makeHarness();
    const { run, question } = await h.askedRun('head-viejo');
    Object.assign(h.runRow(run.id) as object, { current: false });

    const set = await h.service.getQuestionSet(run.id, USERS.maintainer.id);

    expect(set.currentQuestion).toBeNull();
    expect(h.question(question.id).status).toBe('OBSOLETE');
  });
});

describe('OE3-C3: un usuario WRITER no puede confirmar ni persistir FK', () => {
  it.each([
    ['admin', USERS.adminPermission.role, USERS.adminPermission],
    ['maintain', USERS.maintainer.role, USERS.maintainer],
    ['write', USERS.writer.role, USERS.writer],
    ['triage', USERS.triage.role, USERS.triage],
    ['read', USERS.reader.role, USERS.reader],
  ] as const)('OE3-C3: el permiso de GitHub "%s" se mapea al rol %s en el alta de acceso (mapeo real)', async (_permission, _role, user) => {
    const h = makeHarness();

    const grant = await h.projectAccess.require(user.id, PROJECT_ID, 'READER');

    expect(grant.role).toBe(user.role);
    expect(h.db.tables.projectAccess.filter((row) => row.userId === user.id).map((row) => row.role)).toEqual([user.role]);
  });

  it('OE3-C3: el owner de la organización es ADMIN y WRITER conserva capacidades operativas sin llegar a MAINTAINER', async () => {
    const h = makeHarness();

    await expect(h.projectAccess.require(USERS.owner.id, PROJECT_ID, 'MAINTAINER')).resolves.toMatchObject({ role: 'ADMIN' });
    await expect(h.projectAccess.require(USERS.writer.id, PROJECT_ID, 'WRITER')).resolves.toMatchObject({ role: 'WRITER' });
    await expect(h.projectAccess.require(USERS.writer.id, PROJECT_ID, 'MAINTAINER')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
      details: { requiredRole: 'MAINTAINER', currentRole: 'WRITER' },
    });
  });

  it.each([
    ['WRITER', USERS.writer],
    ['READER (read)', USERS.reader],
    ['READER (triage)', USERS.triage],
  ] as const)('OE3-C3: %s recibe 403 PROJECT_ROLE_INSUFFICIENT al responder y no se confirma ni persiste ninguna FK', async (_label, user) => {
    const h = makeHarness();
    const { run, question } = await h.askedRun();

    await expect(
      h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0' }, user.id),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
      status: 403,
      details: { requiredRole: 'MAINTAINER', currentRole: user.role },
    });

    expect(h.knowledge()).toEqual([]);
    expect(h.question(question.id)).toMatchObject({ status: 'PENDING', knowledgeId: null, answerChoice: null });
    expect(h.runRow(run.id)?.status).toBe('ACTION_REQUIRED');
    expect(h.requestContinuation).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('OE3-C3: WRITER tampoco puede resolver un conflicto con SUPERSEDE: la regla ACTIVE existente no se toca', async () => {
    const h = makeHarness();
    const first = await h.askedRun('head-1');
    const second = await h.askedRun('head-2');
    await h.service.submitAnswer(first.run.id, first.question.id, { choice: 'YES', answer: 'regla vigente' }, USERS.maintainer.id);
    const before = structuredClone(h.knowledge());

    await expect(
      h.service.submitAnswer(
        second.run.id,
        second.question.id,
        { choice: 'NO', answer: 'otra', conflictResolution: { conflictId: second.question.id, action: 'SUPERSEDE' } },
        USERS.writer.id,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_ROLE_INSUFFICIENT, status: 403 });

    expect(h.knowledge()).toEqual(before);
    expect(h.question(second.question.id).status).toBe('PENDING');
  });
});

describe('OE3-C4: UNKNOWN deja la solicitud pendiente, no crea FK y no continúa la generación', () => {
  it('OE3-C4: UNKNOWN de un MAINTAINER registra una abstención auditada (quién, rol y cuándo) y la pregunta sigue PENDING sin FK ni continuación', async () => {
    const h = makeHarness();
    const { run, question } = await h.askedRun();

    const accepted = await h.service.submitAnswer(run.id, question.id, { choice: 'UNKNOWN' }, USERS.maintainer.id);

    expect(accepted).toMatchObject({ outcome: 'ABSTAINED', status: 'PENDING', knowledgeId: null, continuationAttemptId: null });
    expect(h.question(question.id)).toMatchObject({ status: 'PENDING', answerChoice: null, answerText: null, knowledgeId: null });
    expect(h.knowledge()).toEqual([]);
    expect(h.runRow(run.id)?.status).toBe('ACTION_REQUIRED');
    expect(h.requestContinuation).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
    expect(h.abstentions()).toMatchObject([{ questionId: question.id, userId: USERS.maintainer.id, role: 'MAINTAINER', createdAt: expect.any(Date) }]);

    // La abstención es visible en la propia solicitud pendiente (auditoría: quién, rol y cuándo).
    const set = await h.service.getQuestionSet(run.id, USERS.maintainer.id);
    expect(set.currentQuestion).toMatchObject({
      id: question.id,
      status: 'PENDING',
      abstention: { count: 1, lastByUserId: USERS.maintainer.id, lastByRole: 'MAINTAINER', lastAt: (h.abstentions()[0].createdAt as Date).toISOString() },
    });
  });

  it('OE3-C4: un ADMIN que repite UNKNOWN suma otra abstención con su rol; el manejador de continuación no reanuda el Run (no hay generación)', async () => {
    const h = makeHarness();
    const { run, question } = await h.askedRun();
    await h.service.submitAnswer(run.id, question.id, { choice: 'UNKNOWN' }, USERS.maintainer.id);

    await h.service.submitAnswer(run.id, question.id, { choice: 'UNKNOWN' }, USERS.owner.id);

    expect(h.abstentions().map((row) => [row.userId, row.role])).toEqual([
      [USERS.maintainer.id, 'MAINTAINER'],
      [USERS.owner.id, 'ADMIN'],
    ]);
    expect(h.question(question.id).status).toBe('PENDING');
    expect(h.knowledge()).toEqual([]);

    await h.handler.handle({ analysisRunId: run.id });
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
    expect(h.runRow(run.id)?.status).toBe('ACTION_REQUIRED');
  });

  it('OE3-C4: tras UNKNOWN la solicitud sigue abierta: una respuesta posterior de un MAINTAINER sí crea la FK y continúa', async () => {
    const h = makeHarness();
    const { run, question } = await h.askedRun();
    await h.service.submitAnswer(run.id, question.id, { choice: 'UNKNOWN' }, USERS.owner.id);

    const accepted = await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0' }, USERS.maintainer.id);

    expect(accepted).toMatchObject({ outcome: 'ANSWERED' });
    expect(active(h)).toHaveLength(1);
    expect(h.jobs.enqueue).toHaveBeenCalledWith(FUNCTIONAL_CONTINUATION_JOB_TYPE, { analysisRunId: run.id });
  });

  it.each([
    ['WRITER', USERS.writer],
    ['READER', USERS.reader],
  ] as const)('OE3-C4: UNKNOWN de un %s se rechaza con 403 y no deja ninguna abstención', async (_label, user) => {
    const h = makeHarness();
    const { run, question } = await h.askedRun();

    await expect(h.service.submitAnswer(run.id, question.id, { choice: 'UNKNOWN' }, user.id)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
    });

    expect(h.abstentions()).toEqual([]);
    expect(h.question(question.id).status).toBe('PENDING');
  });
});

describe('OE3-C5: una regla posterior sustituye a la previa; las reglas independientes coexisten ACTIVE', () => {
  it('OE3-C5: una regla posterior de la misma clave (SUPERSEDE explícito) deja la previa en SUPERSEDED con supersedesId y una sola ACTIVE', async () => {
    const h = makeHarness();
    const first = await h.askedRun('head-1');
    const second = await h.askedRun('head-2');
    await h.service.submitAnswer(first.run.id, first.question.id, { choice: 'YES', answer: 'regla v1' }, USERS.maintainer.id);
    const [v1] = active(h);

    await h.service.submitAnswer(
      second.run.id,
      second.question.id,
      { choice: 'NO', answer: 'regla v2', conflictResolution: { conflictId: second.question.id, action: 'SUPERSEDE' } },
      USERS.owner.id,
    );

    const rules = h.knowledge();
    const [v2] = active(h);
    expect(rules).toHaveLength(2);
    expect(active(h)).toHaveLength(1);
    expect(h.knowledge().find((row) => row.id === v1.id)).toMatchObject({ status: 'SUPERSEDED', normalizedRule: 'regla v1' });
    expect(v2).toMatchObject({ normalizedRule: 'regla v2', supersedesId: v1.id, status: 'ACTIVE', confirmedRole: 'ADMIN', originHeadSha: 'head-2' });
    expect(h.question(second.question.id)).toMatchObject({ status: 'ANSWERED', knowledgeId: v2.id });
  });

  it('OE3-C5: reglas de claves distintas (otro escenario u otro target) coexisten como ACTIVE sin conflicto ni sustitución', async () => {
    const h = makeHarness();
    h.symbols.splice(
      0,
      h.symbols.length,
      symbol({ constructs: [{ scenarioKind: 'EXPECTED_RESULT', scenarioKey: KEY_A, snippet: 'a' }, BOUNDARY_CONSTRUCT] }),
      symbol({ qualifiedName: 'Thing.other', constructs: [{ scenarioKind: 'EXPECTED_RESULT', scenarioKey: KEY_A, snippet: 'a' }] }),
    );
    const answered: string[] = [];

    for (const head of ['head-1', 'head-2', 'head-3']) {
      const { run, question } = await h.askedRun(head);
      await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: `regla ${question.qualifiedName} ${question.scenarioKey}` }, USERS.maintainer.id);
      answered.push(`${question.qualifiedName}|${question.scenarioKey}`);
    }

    expect(new Set(answered).size).toBe(3);
    expect(h.knowledge()).toHaveLength(3);
    expect(h.knowledge().every((row) => row.status === 'ACTIVE' && row.supersedesId === null)).toBe(true);
    expect(active(h, KEY_A, TARGET_REF)).toHaveLength(1);
    expect(active(h, KEY_B, TARGET_REF)).toHaveLength(1);
    expect(active(h, KEY_A, 'src/thing.ts::Thing.other')).toHaveLength(1);
  });

  it('OE3-C5: tres versiones sucesivas de la misma clave forman un linaje reconstruible por supersedesId y createdAt, con una sola ACTIVE', async () => {
    const h = makeHarness();
    const questions = [await h.askedRun('head-1'), await h.askedRun('head-2'), await h.askedRun('head-3')];
    await h.service.submitAnswer(questions[0].run.id, questions[0].question.id, { choice: 'YES', answer: 'v1' }, USERS.maintainer.id);
    for (const [index, { run, question }] of questions.slice(1).entries()) {
      await h.service.submitAnswer(
        run.id,
        question.id,
        { choice: 'NO', answer: `v${index + 2}`, conflictResolution: { conflictId: question.id, action: 'SUPERSEDE' } },
        USERS.maintainer.id,
      );
    }

    const byTime = [...h.knowledge()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(byTime.map((row) => [row.normalizedRule, row.status])).toEqual([['v1', 'SUPERSEDED'], ['v2', 'SUPERSEDED'], ['v3', 'ACTIVE']]);
    expect(byTime.map((row) => row.supersedesId)).toEqual([null, byTime[0].id, byTime[1].id]);
    expect(active(h)).toHaveLength(1);
  });
});

describe('OE3-C6: un conflicto se conserva para resolución explícita y no se sobrescribe silenciosamente', () => {
  async function conflictScenario() {
    const h = makeHarness();
    const first = await h.askedRun('head-1');
    const second = await h.askedRun('head-2');
    await h.service.submitAnswer(first.run.id, first.question.id, { choice: 'YES', answer: 'regla vigente' }, USERS.maintainer.id);
    const [winner] = active(h);
    return { h, first, second, winner, snapshot: structuredClone(h.knowledge()) };
  }

  it('OE3-C6: una respuesta que contradice la regla ACTIVE responde 409 con la regla ganadora y la propuesta, sin escribir nada ni continuar', async () => {
    const { h, second, winner, snapshot } = await conflictScenario();
    h.requestContinuation.mockClear();
    h.jobs.enqueue.mockClear();

    const error = await h.service
      .submitAnswer(second.run.id, second.question.id, { choice: 'NO', answer: 'regla distinta' }, USERS.owner.id)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT,
      status: 409,
      details: {
        conflictId: second.question.id,
        questionId: second.question.id,
        analysisRunId: second.run.id,
        proposedNormalizedRule: 'regla distinta',
        conflictingKnowledge: { id: winner.id, status: 'ACTIVE', normalizedRule: 'regla vigente' },
      },
    });
    expect(h.knowledge()).toEqual(snapshot);
    expect(h.question(second.question.id)).toMatchObject({ status: 'PENDING', knowledgeId: null });
    expect(h.requestContinuation).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('OE3-C6: KEEP_EXISTING explícito conserva la regla ACTIVE intacta, no crea FK y cierra la pregunta', async () => {
    const { h, second, winner, snapshot } = await conflictScenario();

    const accepted = await h.service.submitAnswer(
      second.run.id,
      second.question.id,
      { choice: 'NO', answer: 'regla distinta', conflictResolution: { conflictId: second.question.id, action: 'KEEP_EXISTING' } },
      USERS.maintainer.id,
    );

    expect(accepted).toMatchObject({ outcome: 'ANSWERED', knowledgeId: null });
    expect(h.knowledge()).toEqual(snapshot);
    expect(active(h)).toEqual([expect.objectContaining({ id: winner.id, normalizedRule: 'regla vigente' })]);
    expect(h.question(second.question.id).status).toBe('ANSWERED');
  });

  it('OE3-C6: SUPERSEDE explícito conserva la regla anterior como SUPERSEDED (con su respuesta original) y activa la nueva', async () => {
    const { h, second, winner } = await conflictScenario();

    await h.service.submitAnswer(
      second.run.id,
      second.question.id,
      { choice: 'NO', answer: 'regla nueva', conflictResolution: { conflictId: second.question.id, action: 'SUPERSEDE' } },
      USERS.maintainer.id,
    );

    expect(h.knowledge().find((row) => row.id === winner.id)).toMatchObject({ status: 'SUPERSEDED', originalAnswer: 'regla vigente', normalizedRule: 'regla vigente' });
    expect(active(h)).toEqual([expect.objectContaining({ normalizedRule: 'regla nueva', supersedesId: winner.id })]);
    expect(h.knowledge()).toHaveLength(2);
  });

  it('OE3-C6: una resolución con un conflictId ajeno se rechaza (404) y no escribe', async () => {
    const { h, second, snapshot } = await conflictScenario();

    await expect(
      h.service.submitAnswer(
        second.run.id,
        second.question.id,
        { choice: 'NO', answer: 'regla nueva', conflictResolution: { conflictId: 'otro-conflicto', action: 'SUPERSEDE' } },
        USERS.maintainer.id,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });

    expect(h.knowledge()).toEqual(snapshot);
    expect(h.question(second.question.id).status).toBe('PENDING');
  });

  it('OE3-C6: en una carrera (lectura previa sin regla, índice ACTIVE ya ocupado) también responde 409 con la ganadora y no sobrescribe', async () => {
    const { h, second, winner, snapshot } = await conflictScenario();
    // La lectura de `findActive` del servicio llega antes de que la otra respuesta confirme: no ve la regla ganadora.
    const findActive = vi.spyOn(h.knowledgeRepository, 'findActive').mockResolvedValueOnce(null);

    const error = await h.service
      .submitAnswer(second.run.id, second.question.id, { choice: 'NO', answer: 'regla en carrera' }, USERS.maintainer.id)
      .catch((caught: unknown) => caught);
    findActive.mockRestore();

    expect(error).toMatchObject({
      code: ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT,
      status: 409,
      details: { conflictingKnowledge: { id: winner.id }, proposedNormalizedRule: 'regla en carrera' },
    });
    expect(h.knowledge()).toEqual(snapshot);
    expect(h.question(second.question.id).status).toBe('PENDING');
  });
});

describe('OE3-Tabla63: campos mínimos de auditoría de Functional Knowledge', () => {
  /** Los campos de la Tabla 63 exigibles a toda regla ACTIVE creada por el mecanismo. */
  function expectAuditFields(rule: FunctionalKnowledge, expected: Partial<FunctionalKnowledge>) {
    expect(rule).toMatchObject({
      projectId: PROJECT_ID,
      targetRef: TARGET_REF,
      scope: 'METHOD',
      source: 'HUMAN_ANSWER',
      status: 'ACTIVE',
      scenarioKey: KEY_A,
      ...expected,
    });
    expect(rule.confirmedByUserId).toEqual(expect.any(String));
    expect(['ADMIN', 'MAINTAINER']).toContain(rule.confirmedRole);
    expect(rule.originHeadSha).toEqual(expect.any(String));
    expect(rule.createdAt).toBeInstanceOf(Date);
  }

  it.each([
    ['MAINTAINER', USERS.maintainer],
    ['ADMIN', USERS.owner],
  ] as const)(
    'OE3-Tabla63: la regla confirmada por un %s guarda project/target, source, scope, scenarioKey, status, confirmedByUserId, confirmedRole y originHeadSha',
    async (role, user) => {
      const h = makeHarness();
      const { run, question } = await h.askedRun('head-origen');

      await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0' }, user.id);

      const [rule] = active(h);
      expectAuditFields(rule, { confirmedByUserId: user.id, confirmedRole: role, originHeadSha: 'head-origen', sourceRef: null });
      expect(rule.originalQuestion).toBe(question.question);
      expect(rule.originalAnswer).toBe('devuelve 0');
    },
  );

  it('OE3-Tabla63: la respuesta de la API de la regla expone los mismos campos de auditoría', async () => {
    const h = makeHarness();
    const { run, question } = await h.askedRun('head-origen');
    await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0' }, USERS.owner.id);

    const response = toFunctionalKnowledgeResponse(active(h)[0]);

    expect(response).toMatchObject({
      projectId: PROJECT_ID,
      targetRef: TARGET_REF,
      scope: 'METHOD',
      source: 'HUMAN_ANSWER',
      status: 'ACTIVE',
      scenarioKey: KEY_A,
      confirmedByUserId: USERS.owner.id,
      confirmedRole: 'ADMIN',
      originHeadSha: 'head-origen',
      sourceRef: null,
    });
    expect(response).not.toHaveProperty('version');
  });

  it('OE3-Tabla63: de todos los roles que intentan confirmar, solo ADMIN y MAINTAINER dejan FK persistida con confirmedRole ADMIN o MAINTAINER', async () => {
    const h = makeHarness();
    h.symbols.splice(
      0,
      h.symbols.length,
      ...['One', 'Two', 'Three', 'Four', 'Five'].map((name) => symbol({ qualifiedName: `Thing.${name}` })),
    );
    const attempts = [USERS.owner, USERS.maintainer, USERS.writer, USERS.triage, USERS.reader];

    for (const [index, user] of attempts.entries()) {
      const run = h.newRun(`head-${index}`);
      await h.evaluator.evaluate(h.runRow(run.id) as AnalysisRun);
      const question = h.questions().find((candidate) => candidate.analysisRunId === run.id) as FunctionalQuestion;
      await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: `regla de ${user.id}` }, user.id).catch(() => undefined);
    }

    expect(h.knowledge().map((row) => [row.confirmedByUserId, row.confirmedRole])).toEqual([
      [USERS.owner.id, 'ADMIN'],
      [USERS.maintainer.id, 'MAINTAINER'],
    ]);
  });

  it('OE3-Tabla63: originHeadSha es procedencia, no vencimiento: tras un HEAD nuevo la regla sigue ACTIVE y cubre la construcción', async () => {
    const h = makeHarness();
    const { run, question } = await h.askedRun('head-origen');
    await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'devuelve 0' }, USERS.maintainer.id);
    const nextRun = h.newRun('head-posterior');

    const { result, pending } = await h.ask(nextRun);
    const covering = await h.knowledgeRepository.findActive(PROJECT_ID, 'METHOD', TARGET_REF, KEY_A);

    expect(result).toEqual({ actionRequired: false });
    expect(pending).toEqual([]);
    expect(covering).toMatchObject({ status: 'ACTIVE', originHeadSha: 'head-origen' });
  });

  it('OE3-Tabla63: sourceRef solo existe con source APPROVED_IMPORT; con otra fuente el repositorio lo rechaza', async () => {
    const h = makeHarness();
    // Una regla confirmada por el mecanismo de preguntas nunca lleva sourceRef.
    const { run, question } = await h.askedRun('head-1');
    await h.service.submitAnswer(run.id, question.id, { choice: 'YES', answer: 'x' }, USERS.maintainer.id);
    expect(active(h)).toMatchObject([{ source: 'HUMAN_ANSWER', sourceRef: null }]);

    const base = {
      projectId: PROJECT_ID,
      scope: 'METHOD' as const,
      targetRef: TARGET_REF,
      originalQuestion: 'q',
      originalAnswer: 'a',
      normalizedRule: 'a',
      confirmedByUserId: USERS.owner.id,
      confirmedRole: 'ADMIN' as const,
      originHeadSha: 'head-1',
      scenarioKind: 'BOUNDARY' as const,
      scenarioKey: KEY_B,
    };
    await expect(h.knowledgeRepository.create({ ...base, sourceRef: 'import://acme/rules#12' })).rejects.toThrow(/sourceRef/);
    expect(h.knowledge()).toHaveLength(1);

    const imported = await h.knowledgeRepository.create({ ...base, source: 'APPROVED_IMPORT', sourceRef: 'import://acme/rules#12' });

    expect(imported).toMatchObject({ source: 'APPROVED_IMPORT', sourceRef: 'import://acme/rules#12', status: 'ACTIVE', confirmedRole: 'ADMIN' });
  });

  it('OE3-Tabla63: la versión de una regla es su linaje (supersedesId + createdAt); no existe una columna version (D-23)', async () => {
    const h = makeHarness();
    const first = await h.askedRun('head-1');
    const second = await h.askedRun('head-2');
    await h.service.submitAnswer(first.run.id, first.question.id, { choice: 'YES', answer: 'v1' }, USERS.maintainer.id);
    await h.service.submitAnswer(
      second.run.id,
      second.question.id,
      { choice: 'NO', answer: 'v2', conflictResolution: { conflictId: second.question.id, action: 'SUPERSEDE' } },
      USERS.maintainer.id,
    );

    const [current] = active(h);
    const lineage: FunctionalKnowledge[] = [];
    for (let node: FunctionalKnowledge | undefined = current; node; node = h.knowledge().find((row) => row.id === node?.supersedesId)) {
      lineage.unshift(node);
    }

    expect(lineage.map((row) => row.normalizedRule)).toEqual(['v1', 'v2']);
    expect(lineage[0].createdAt.getTime()).toBeLessThan(lineage[1].createdAt.getTime());
    expect(lineage.map((row) => row.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
    for (const row of h.knowledge()) {
      expect('version' in row).toBe(false);
    }
  });
});
