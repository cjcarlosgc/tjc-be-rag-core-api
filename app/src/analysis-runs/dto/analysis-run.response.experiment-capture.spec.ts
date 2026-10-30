import { describe, expect, it, vi } from 'vitest';
import type { AnalysisRun } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AnalysisRunsRepository, RUN_EXPERIMENT_CAPTURE_INCLUDE } from '../analysis-runs.repository.js';
import { toAnalysisRunDetailResponse, toAnalysisRunSummaryResponse, type AnalysisRunWithCapture } from './analysis-run.response.js';

/** WI-CORE-109 (INTEROP-2.25): `experimentCapture` siempre presente en el resumen y en el detalle (null si no hay). */
describe('AnalysisRun response: experimentCapture (WI-CORE-109)', () => {
  const base = {
    id: 'run-1',
    projectId: 'project-1',
    repositoryId: '123',
    repositoryName: 'org/repo',
    prNumber: 42,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    draft: false,
    prState: 'OPEN',
    actorLogin: 'octocat',
    status: 'SUCCESS',
    current: true,
    actionRequiredCount: 0,
    generatedTestsCount: 0,
    createdAt: new Date('2026-10-30T09:00:00.000Z'),
    updatedAt: new Date('2026-10-30T09:05:00.000Z'),
    completedAt: null,
    attemptCount: 0,
    indexMode: 'BOOTSTRAP',
    changesetBaseSha: 'base-sha',
    changesetHeadSha: 'head-sha',
    indexDeltaBaseSha: null,
    functionalBehaviorValidated: false,
    resultSummary: null,
    experimentCaptureId: null,
  } as unknown as AnalysisRun;

  it('un Run sin reserva expone experimentCapture: null en el resumen', () => {
    const response = toAnalysisRunSummaryResponse({ ...base, experimentCapture: null } as AnalysisRunWithCapture);

    expect(response).toHaveProperty('experimentCapture', null);
  });

  it('un Run sin el include cargado también responde null (nunca un objeto inventado)', () => {
    const response = toAnalysisRunSummaryResponse(base as AnalysisRunWithCapture);

    expect(response.experimentCapture).toBeNull();
  });

  it('un Run reservado expone captureId y reservedAt en ISO-8601 UTC', () => {
    const run = {
      ...base,
      experimentCaptureId: 'capture-1',
      experimentCapture: { id: 'capture-1', reservedAt: new Date('2026-10-30T09:01:00.000Z') },
    } as unknown as AnalysisRunWithCapture;

    expect(toAnalysisRunSummaryResponse(run).experimentCapture).toEqual({
      captureId: 'capture-1',
      reservedAt: '2026-10-30T09:01:00.000Z',
    });
  });

  it('el detalle (y por tanto analysis-run:update) hereda el mismo campo', () => {
    const run = {
      ...base,
      experimentCaptureId: 'capture-1',
      experimentCapture: { id: 'capture-1', reservedAt: new Date('2026-10-30T09:01:00.000Z') },
    } as unknown as AnalysisRunWithCapture;

    const detail = toAnalysisRunDetailResponse(run, []);

    expect(detail.experimentCapture).toEqual({ captureId: 'capture-1', reservedAt: '2026-10-30T09:01:00.000Z' });
    expect(detail.detailsUrl).toBe('/projects/project-1/runs/run-1');
  });
});

/**
 * Sin N+1: las listas traen la captura en la MISMA consulta (`include`), una sola llamada a `findMany` por página.
 */
describe('AnalysisRunsRepository: listas con experimentCapture en una sola consulta (WI-CORE-109)', () => {
  it('findByProjectForOwner y findVisibleForUser hacen un único findMany con la captura incluida', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new AnalysisRunsRepository({ analysisRun: { findMany } } as unknown as PrismaService);

    await repository.findByProjectForOwner('project-1', 'user-1', 20, undefined, undefined);
    await repository.findVisibleForUser('user-1', 20, undefined, undefined);

    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [args] of findMany.mock.calls) {
      expect(args.include).toEqual(RUN_EXPERIMENT_CAPTURE_INCLUDE);
    }
  });
});
