import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunChecksService } from './analysis-run-checks.service.js';
import { mapRunStatusToCheckConclusion } from './check-conclusion.util.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { GithubChecksService } from '../github-app/github-checks.service.js';
import type { AnalysisRun, AnalysisRunStatus, RepositoryBinding } from '../generated/prisma/client.js';

/**
 * WI-CORE-109 (D1): un Run reservado por la captura de experimentación no publica Check en el PR, por ningún
 * llamador del embudo `publishForRun`. Un Run sin captura conserva el comportamiento de siempre.
 */
const binding: RepositoryBinding = {
  id: 'binding-1',
  projectId: 'project-1',
  installationId: '999',
  repositoryId: '123',
  repositoryName: 'org/repo',
  integrationBranch: 'develop',
  status: 'ENABLED',
  disabledReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryId: '123',
    headSha: 'head-sha',
    status: 'SUCCESS',
    current: true,
    resultSummary: 'todo bien',
    checkId: null,
    checkPublishedAt: null,
    experimentCaptureId: 'capture-1',
    ...overrides,
  } as AnalysisRun;
}

/** Todos los estados que algún llamador puede publicar: los terminales y ACTION_REQUIRED. */
const PUBLISHABLE_STATUSES: AnalysisRunStatus[] = [
  'ACTION_REQUIRED',
  'SUCCESS',
  'BEHAVIORAL_MISMATCH',
  'TECHNICAL_GENERATION_FAILURE',
  'INFRASTRUCTURE_FAILURE',
  'BASELINE_FAILED',
  'NO_ADDITIONAL_TESTS_REQUIRED',
  'NO_TEST_RELEVANT_CHANGES',
];

describe('AnalysisRunChecksService con Run reservado (WI-CORE-109, D1)', () => {
  let service: AnalysisRunChecksService;
  let analysisRunsRepository: { findById: ReturnType<typeof vi.fn>; markCheckPublished: ReturnType<typeof vi.fn> };
  let repositoryBindingsRepository: { findForRun: ReturnType<typeof vi.fn> };
  let githubChecksService: { createCheckRun: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    analysisRunsRepository = {
      findById: vi.fn().mockImplementation(async (id: string) => buildRun({ id })),
      markCheckPublished: vi.fn().mockResolvedValue(buildRun()),
    };
    repositoryBindingsRepository = { findForRun: vi.fn().mockResolvedValue(binding) };
    githubChecksService = { createCheckRun: vi.fn().mockResolvedValue({ checkId: 'check-1' }) };
    service = new AnalysisRunChecksService(
      analysisRunsRepository as unknown as AnalysisRunsRepository,
      repositoryBindingsRepository as unknown as RepositoryBindingsRepository,
      githubChecksService as unknown as GithubChecksService,
      { get: vi.fn((_key: string, fallback?: unknown) => fallback) } as never,
    );
  });

  it.each(PUBLISHABLE_STATUSES)(
    'un Run reservado en %s no llama a GitHub Integration ni escribe checkId/checkPublishedAt',
    async (status) => {
      await service.publishForRun(buildRun({ status }));

      expect(githubChecksService.createCheckRun).not.toHaveBeenCalled();
      expect(analysisRunsRepository.markCheckPublished).not.toHaveBeenCalled();
      expect(analysisRunsRepository.findById).not.toHaveBeenCalled();
    },
  );

  it('detecta la reserva aunque el objeto llegue sin el campo: la relee de la base y no publica', async () => {
    // Un llamador que pase un objeto anterior a la reserva (sin el campo) no debe publicar el Check.
    const staleObject = buildRun({ status: 'SUCCESS', experimentCaptureId: undefined });
    analysisRunsRepository.findById.mockResolvedValue(buildRun({ status: 'SUCCESS', experimentCaptureId: 'capture-1' }));

    await service.publishForRun(staleObject);

    expect(analysisRunsRepository.findById).toHaveBeenCalledWith('run-1');
    expect(githubChecksService.createCheckRun).not.toHaveBeenCalled();
    expect(analysisRunsRepository.markCheckPublished).not.toHaveBeenCalled();
  });

  it('un Run sin captura (null o ausente) publica su Check exactamente como antes', async () => {
    analysisRunsRepository.findById.mockImplementation(async (id: string) =>
      buildRun({ id, experimentCaptureId: null }),
    );

    await service.publishForRun(buildRun({ status: 'SUCCESS', experimentCaptureId: null }));
    await service.publishForRun(buildRun({ status: 'SUCCESS', experimentCaptureId: undefined }));

    expect(githubChecksService.createCheckRun).toHaveBeenCalledTimes(2);
    expect(githubChecksService.createCheckRun).toHaveBeenCalledWith(
      '999',
      'org/repo',
      expect.objectContaining({ headSha: 'head-sha', conclusion: 'success' }),
    );
    expect(analysisRunsRepository.markCheckPublished).toHaveBeenCalledWith('run-1', 'check-1');
  });

  it('el mapeo de conclusión sigue siendo el de siempre para los estados publicables', () => {
    for (const status of PUBLISHABLE_STATUSES) {
      expect(mapRunStatusToCheckConclusion(status)).not.toBeNull();
    }
  });
});
