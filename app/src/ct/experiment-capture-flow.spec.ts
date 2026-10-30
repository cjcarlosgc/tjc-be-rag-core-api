import { describe, expect, it, vi } from 'vitest';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import type { CreateAnalysisRunInput } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunChecksService } from '../checks/analysis-run-checks.service.js';
import {
  ExperimentCaptureAlreadyArmedError,
} from '../experiment-captures/persistence/experiment-captures.repository.js';
import { ExperimentsService } from '../experiments/experiments.service.js';
import type { AnalysisRun } from '../generated/prisma/client.js';
import type { LLMEffectiveConfig } from '../providers/llm-provider.interface.js';

/**
 * WI-CORE-109 (HU18), extremo a extremo con fakes y sin red: armar la captura ⇒ webhook ⇒ Run reservado ⇒
 * snapshot/validación ⇒ ningún Check en el PR ⇒ `POST /experiments` aceptado sobre ese Run. Usa los servicios
 * reales de Runs, Checks y Experimentos; solo sustituye persistencia, GitHub, LLM y cola.
 */
const PROJECT_ID = 'project-1';
const OWNER = 'user-maintainer';
const VERSION_ID = 'version-1';
const REPO_ID = '123';

const EFFECTIVE_CONFIG: LLMEffectiveConfig = {
  provider: 'openai',
  model: 'gpt-6-luna',
  modelVersion: 'gpt-6-luna-2026',
  reasoningEffort: 'medium',
  temperature: null,
  maxOutputTokens: null,
};

interface FakeCapture {
  id: string;
  projectId: string;
  status: 'ARMED' | 'RESERVED' | 'DISARMED';
  reservedAt: Date | null;
  reservedAnalysisRunId: string | null;
}

function eligibleInput(overrides: Partial<CreateAnalysisRunInput> & { prNumber?: number; headSha?: string } = {}): CreateAnalysisRunInput {
  return {
    projectId: PROJECT_ID,
    repositoryId: REPO_ID,
    repositoryName: 'org/repo',
    prNumber: 42,
    pullRequestCreatedAt: new Date('2026-10-30T09:00:00.000Z'),
    repositoryBindingEligible: true,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha',
    headSha: 'head-a',
    draft: false,
    actorLogin: 'octocat',
    ...overrides,
  };
}

function fixture() {
  const runs: AnalysisRun[] = [];
  const captures: FakeCapture[] = [];
  let sequence = 0;
  let failNextReservation = false;

  const withCapture = (run: AnalysisRun) => {
    const capture = captures.find((candidate) => candidate.id === run.experimentCaptureId);
    return { ...run, experimentCapture: capture ? { id: capture.id, reservedAt: capture.reservedAt } : null } as AnalysisRun;
  };

  const repository = {
    findCurrentByPullRequest: vi.fn(async (projectId: string, repositoryId: string, prNumber: number) =>
      runs.find((run) => run.current && run.projectId === projectId && run.repositoryId === repositoryId && run.prNumber === prNumber) ?? null),
    create: vi.fn(async (input: CreateAnalysisRunInput) => {
      sequence += 1;
      const run = {
        id: `run-${sequence}`,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        repositoryName: input.repositoryName,
        prNumber: input.prNumber,
        pullRequestCreatedAt: input.pullRequestCreatedAt ?? null,
        repositoryBindingEligible: input.repositoryBindingEligible ?? null,
        prTitle: input.prTitle,
        baseRef: input.baseRef,
        headRef: input.headRef,
        baseSha: input.baseSha,
        headSha: input.headSha,
        changesetBaseSha: input.baseSha,
        changesetHeadSha: input.headSha,
        draft: input.draft,
        actorLogin: input.actorLogin,
        prState: 'OPEN',
        status: 'QUEUED',
        current: true,
        attemptCount: 0,
        indexMode: 'BOOTSTRAP',
        indexDeltaBaseSha: null,
        projectVersionId: null,
        functionalBehaviorValidated: false,
        actionRequiredCount: 0,
        generatedTestsCount: 0,
        resultSummary: null,
        checkId: null,
        checkPublishedAt: null,
        experimentCaptureId: null,
        completedAt: null,
        createdAt: new Date('2026-10-30T09:00:00.000Z'),
        updatedAt: new Date('2026-10-30T09:00:00.000Z'),
      } as unknown as AnalysisRun;
      runs.push(run);
      return withCapture(run);
    }),
    transitionCurrent: vi.fn(async (id: string, from: string, to: string, patch: Record<string, unknown>) => {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run || !run.current || run.status !== from) return null;
      Object.assign(run, patch, { status: to });
      return withCapture(run);
    }),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => {
      const run = runs.find((candidate) => candidate.id === id)!;
      Object.assign(run, data);
      return withCapture(run);
    }),
    findById: vi.fn(async (id: string) => {
      const run = runs.find((candidate) => candidate.id === id);
      return run ? withCapture(run) : null;
    }),
    findByIdForOwner: vi.fn(async (id: string) => {
      const run = runs.find((candidate) => candidate.id === id);
      return run ? withCapture(run) : null;
    }),
    markCheckPublished: vi.fn(async (id: string, checkId: string | null) => {
      const run = runs.find((candidate) => candidate.id === id)!;
      Object.assign(run, { checkPublishedAt: new Date(), ...(checkId ? { checkId } : {}) });
      return withCapture(run);
    }),
  };

  /** Mismo contrato que la transacción real: escribe la captura y el Run juntos, o no escribe nada. */
  const captureRepository = {
    arm: vi.fn(async (projectId: string) => {
      if (captures.some((capture) => capture.projectId === projectId && capture.status === 'ARMED')) {
        throw new ExperimentCaptureAlreadyArmedError(projectId);
      }
      const capture: FakeCapture = { id: `capture-${captures.length + 1}`, projectId, status: 'ARMED', reservedAt: null, reservedAnalysisRunId: null };
      captures.push(capture);
      return capture;
    }),
    reserveIfArmed: vi.fn(async (projectId: string, analysisRunId: string) => {
      if (failNextReservation) {
        failNextReservation = false;
        throw new Error('simulated reservation failure');
      }
      const capture = captures.find((candidate) => candidate.projectId === projectId && candidate.status === 'ARMED');
      if (!capture) return null;
      const reservedAt = new Date('2026-10-30T09:01:00.000Z');
      Object.assign(capture, { status: 'RESERVED', reservedAt, reservedAnalysisRunId: analysisRunId });
      const run = runs.find((candidate) => candidate.id === analysisRunId)!;
      Object.assign(run, { experimentCaptureId: capture.id });
      return { captureId: capture.id, reservedAt };
    }),
  };

  const github = { createCheckRun: vi.fn(async () => ({ checkId: 'check-1' })) };
  const bindings = {
    findForRun: vi.fn(async () => ({
      id: 'binding-1',
      projectId: PROJECT_ID,
      installationId: '999',
      repositoryId: REPO_ID,
      repositoryName: 'org/repo',
      integrationBranch: 'develop',
      status: 'ENABLED',
    })),
  };
  const realtime = { runChanged: vi.fn().mockResolvedValue(undefined) };

  const runsService = new AnalysisRunsService(
    repository as never,
    { findById: vi.fn() } as never,
    { require: vi.fn().mockResolvedValue({ role: 'WRITER' }) } as never,
    realtime as never,
    captureRepository as never,
  );
  const checks = new AnalysisRunChecksService(
    repository as never,
    bindings as never,
    github as never,
    { get: vi.fn((_key: string, fallback?: unknown) => fallback) } as never,
  );

  const experimentRunsRepository = {
    create: vi.fn(async () => ({ id: 'exp-1' })),
    findByIdForOwner: vi.fn(),
    findRepetitions: vi.fn(),
  };
  const experiments = new ExperimentsService(
    { require: vi.fn().mockResolvedValue({ project: { id: PROJECT_ID }, role: 'WRITER' }) } as never,
    runsService,
    {
      findByAnalysisRun: vi.fn().mockResolvedValue([
        { kind: 'METHOD', qualifiedName: 'Example.run', filePath: 'src/example.ts', changeKind: 'DIRECTLY_CHANGED' },
      ]),
    } as never,
    {
      findById: vi.fn().mockResolvedValue({ id: VERSION_ID, status: 'COMPLETED', detectedFramework: 'VITEST', commitSha: 'c0ffee' }),
    } as never,
    {
      findTestableTargets: vi.fn().mockResolvedValue([
        { id: 'target-1', targetType: 'METHOD', filePath: 'src/example.ts', symbolName: 'Example', methodName: 'run' },
      ]),
    } as never,
    experimentRunsRepository as never,
    { enqueue: vi.fn().mockResolvedValue('job-1') } as never,
    { get: (_key: string, fallback?: unknown) => fallback } as never,
    {
      validateKey: vi.fn(),
      run: vi.fn(async ({ prepare, create }: { prepare?: () => Promise<unknown>; create: (tx: never, prepared: unknown) => Promise<{ response: unknown }> }) => {
        const prepared = prepare ? await prepare() : undefined;
        return (await create(undefined as never, prepared)).response;
      }),
    } as never,
    { resolveEffectiveConfig: vi.fn().mockResolvedValue(EFFECTIVE_CONFIG) } as never,
  );

  return {
    runs,
    captures,
    repository,
    captureRepository,
    github,
    runsService,
    checks,
    experiments,
    experimentRunsRepository,
    failNextReservation: () => {
      failNextReservation = true;
    },
  };
}

/** Lo que hace el snapshot/validación real con un Run ya creado: cada camino termina en un estado distinto. */
type Path =
  | 'snapshot:NO_TEST_RELEVANT_CHANGES'
  | 'snapshot:INFRASTRUCTURE_FAILURE'
  | 'functional:ACTION_REQUIRED'
  | 'validation:SUCCESS'
  | 'validation:BEHAVIORAL_MISMATCH'
  | 'validation:TECHNICAL_GENERATION_FAILURE';

async function runPath(f: ReturnType<typeof fixture>, run: AnalysisRun, path: Path): Promise<void> {
  const processing = await f.runsService.startProcessing(run);

  if (path === 'functional:ACTION_REQUIRED') {
    const required = await f.runsService.markActionRequiredFromSystem(processing);
    await f.checks.publishForRun(required);
    return;
  }

  const outcome = path.split(':')[1] as Parameters<AnalysisRunsService['completeRunFromSystem']>[1];
  const completed = await f.runsService.completeRunFromSystem(processing, outcome, { resultSummary: outcome });
  if (completed) {
    await f.checks.publishForRun(completed);
  }
}

describe('CT WI-CORE-109: captura armada de experimentación, extremo a extremo', () => {
  it('armar ⇒ webhook ⇒ Run reservado ⇒ snapshot ⇒ ningún Check ⇒ POST /experiments aceptado sobre ese Run', async () => {
    const f = fixture();
    await f.captureRepository.arm(PROJECT_ID);

    const { run, isNew } = await f.runsService.startRunFromWebhook(eligibleInput());
    expect(isNew).toBe(true);
    expect(run.experimentCaptureId).toBe('capture-1');
    expect(f.captures[0]).toMatchObject({ status: 'RESERVED', reservedAnalysisRunId: run.id });

    // Snapshot: el Run recibe su versión congelada y termina en BEHAVIORAL_MISMATCH (validación).
    const processing = await f.runsService.startProcessing(run);
    const withSnapshot = await f.runsService.recordSnapshot(processing, {
      indexMode: 'BOOTSTRAP',
      indexDeltaBaseSha: null,
      projectVersionId: VERSION_ID,
    });
    const completed = await f.runsService.completeRunFromSystem(withSnapshot, 'BEHAVIORAL_MISMATCH', {
      resultSummary: 'Discrepancia de comportamiento',
    });
    await f.checks.publishForRun(completed!);

    expect(f.github.createCheckRun).not.toHaveBeenCalled();
    expect(f.repository.markCheckPublished).not.toHaveBeenCalled();

    const accepted = await f.experiments.createRun(
      { analysisRunId: run.id, symbolFilePath: 'src/example.ts', symbolQualifiedName: 'Example.run' },
      'idem-key-1',
      OWNER,
    );

    expect(accepted).toBeDefined();
    expect(f.experimentRunsRepository.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.experimentRunsRepository.create.mock.calls[0])).toContain(run.id);
  });

  it('control: el mismo camino sin captura sí publica el Check (la ausencia de llamadas de arriba es significativa)', async () => {
    const f = fixture();

    const { run } = await f.runsService.startRunFromWebhook(eligibleInput());
    expect(run.experimentCaptureId).toBeNull();

    await runPath(f, run, 'validation:BEHAVIORAL_MISMATCH');

    expect(f.github.createCheckRun).toHaveBeenCalledOnce();
  });

  it.each<Path>([
    'snapshot:NO_TEST_RELEVANT_CHANGES',
    'snapshot:INFRASTRUCTURE_FAILURE',
    'functional:ACTION_REQUIRED',
    'validation:SUCCESS',
    'validation:BEHAVIORAL_MISMATCH',
    'validation:TECHNICAL_GENERATION_FAILURE',
  ])('un Run reservado no publica Check por el camino %s', async (path) => {
    const f = fixture();
    await f.captureRepository.arm(PROJECT_ID);
    const { run } = await f.runsService.startRunFromWebhook(eligibleInput());
    expect(run.experimentCaptureId).not.toBeNull();

    await runPath(f, run, path);

    expect(f.github.createCheckRun).not.toHaveBeenCalled();
    expect(f.repository.markCheckPublished).not.toHaveBeenCalled();
  });

  it('solo el primer Run elegible se reserva: otro PR sigue el camino normal y publica su Check', async () => {
    const f = fixture();
    await f.captureRepository.arm(PROJECT_ID);
    const reserved = await f.runsService.startRunFromWebhook(eligibleInput());
    expect(reserved.run.experimentCaptureId).not.toBeNull();

    const other = await f.runsService.startRunFromWebhook(eligibleInput({ prNumber: 43, headSha: 'head-other' }));

    expect(other.isNew).toBe(true);
    expect(other.run.experimentCaptureId).toBeNull();
    await runPath(f, other.run, 'validation:SUCCESS');
    expect(f.github.createCheckRun).toHaveBeenCalledOnce();
  });

  it('un HEAD nuevo del mismo PR crea otro Run que no se reserva; el reservado queda OBSOLETE y la captura sigue RESERVED', async () => {
    const f = fixture();
    await f.captureRepository.arm(PROJECT_ID);
    const first = await f.runsService.startRunFromWebhook(eligibleInput());

    const second = await f.runsService.startRunFromWebhook(eligibleInput({ headSha: 'head-b' }));

    expect(second.isNew).toBe(true);
    expect(second.run.experimentCaptureId).toBeNull();
    expect(f.runs.find((run) => run.id === first.run.id)).toMatchObject({ status: 'OBSOLETE', current: false });
    expect(f.captures[0]).toMatchObject({ status: 'RESERVED', reservedAnalysisRunId: first.run.id });
  });

  it('no consumen la captura: borrador, duplicado (HEAD sin cambios), PR anterior al vínculo ni no elegible', async () => {
    const f = fixture();
    await f.captureRepository.arm(PROJECT_ID);

    const draft = await f.runsService.startRunFromWebhook(eligibleInput({ prNumber: 44, draft: true }));
    expect(draft.run.experimentCaptureId).toBeNull();

    const beforeBinding = await f.runsService.startRunFromWebhook(eligibleInput({ prNumber: 45, repositoryBindingEligible: false }));
    expect(beforeBinding.run.experimentCaptureId).toBeNull();

    const unclassified = await f.runsService.startRunFromWebhook(eligibleInput({ prNumber: 46, repositoryBindingEligible: null }));
    expect(unclassified.run.experimentCaptureId).toBeNull();

    const first = await f.runsService.startRunFromWebhook(eligibleInput({ prNumber: 47 }));
    expect(first.run.experimentCaptureId).not.toBeNull();
    const duplicate = await f.runsService.startRunFromWebhook(eligibleInput({ prNumber: 47 }));
    expect(duplicate.isNew).toBe(false);

    expect(f.captures.map((capture) => capture.status)).toEqual(['RESERVED']);
    expect(f.captures[0].reservedAnalysisRunId).toBe(first.run.id);
  });

  it('un Run creado antes de armar no se reserva aunque llegue un duplicado después', async () => {
    const f = fixture();
    const before = await f.runsService.startRunFromWebhook(eligibleInput());
    expect(before.run.experimentCaptureId).toBeNull();

    await f.captureRepository.arm(PROJECT_ID);
    const duplicate = await f.runsService.startRunFromWebhook(eligibleInput());

    expect(duplicate.isNew).toBe(false);
    expect(duplicate.run.id).toBe(before.run.id);
    expect(f.captures[0].status).toBe('ARMED');
  });

  it('si el reservador falla, el Run se crea normal y la captura sigue ARMED', async () => {
    const f = fixture();
    await f.captureRepository.arm(PROJECT_ID);
    f.failNextReservation();

    const result = await f.runsService.startRunFromWebhook(eligibleInput());

    expect(result.isNew).toBe(true);
    expect(result.run.experimentCaptureId).toBeNull();
    expect(f.captures[0]).toMatchObject({ status: 'ARMED', reservedAt: null });
  });
});
