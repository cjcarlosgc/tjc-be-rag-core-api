import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateAnalysisRunInput } from './analysis-runs.repository.js';
import { AnalysisRunsService } from './analysis-runs.service.js';
import type { AnalysisRun } from '../generated/prisma/client.js';

/**
 * WI-CORE-109 (HU18): reserva atómica de la captura armada en el embudo `startRunFromWebhook`.
 * Sin captura armada el embudo no cambia; con ella, solo un Run NUEVO, ELEGIBLE y NO borrador se reserva,
 * y un fallo del reservador nunca impide crear el Run.
 */
describe('AnalysisRunsService.startRunFromWebhook con captura de experimentación (WI-CORE-109)', () => {
  const PROJECT_ID = 'project-1';

  function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
    return {
      id: 'run-1',
      projectId: PROJECT_ID,
      repositoryId: 'repo-1',
      repositoryName: 'org/repo',
      prNumber: 42,
      pullRequestCreatedAt: new Date('2026-10-30T09:00:00.000Z'),
      repositoryBindingEligible: true,
      prTitle: 'Add feature',
      baseRef: 'develop',
      headRef: 'feature/x',
      baseSha: 'base-sha-1',
      headSha: 'head-sha-1',
      draft: false,
      prState: 'OPEN',
      actorLogin: 'octocat',
      status: 'QUEUED',
      current: true,
      attemptCount: 0,
      indexMode: 'BOOTSTRAP',
      changesetBaseSha: 'base-sha-1',
      changesetHeadSha: 'head-sha-1',
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
      ...overrides,
    } as AnalysisRun;
  }

  const eligibleInput = (overrides: Partial<CreateAnalysisRunInput> = {}): CreateAnalysisRunInput => ({
    projectId: PROJECT_ID,
    repositoryId: 'repo-1',
    repositoryName: 'org/repo',
    prNumber: 42,
    pullRequestCreatedAt: new Date('2026-10-30T09:00:00.000Z'),
    repositoryBindingEligible: true,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha-1',
    headSha: 'head-sha-1',
    draft: false,
    actorLogin: 'octocat',
    ...overrides,
  });

  let repository: {
    create: ReturnType<typeof vi.fn>;
    findCurrentByPullRequest: ReturnType<typeof vi.fn>;
    transitionCurrent: ReturnType<typeof vi.fn>;
  };
  let captures: { reserveIfArmed: ReturnType<typeof vi.fn> };
  let service: AnalysisRunsService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findCurrentByPullRequest: vi.fn().mockResolvedValue(null),
      transitionCurrent: vi.fn(),
    };
    captures = { reserveIfArmed: vi.fn().mockResolvedValue(null) };
    service = new AnalysisRunsService(
      repository as never,
      { findById: vi.fn() } as never,
      { require: vi.fn() } as never,
      { runChanged: vi.fn().mockResolvedValue(undefined) } as never,
      captures as never,
    );
  });

  it('reserva el Run nuevo, elegible y no borrador cuando hay captura armada, y lo devuelve reservado', async () => {
    repository.create.mockResolvedValue(buildRun());
    captures.reserveIfArmed.mockResolvedValue({ captureId: 'capture-1', reservedAt: new Date() });

    const result = await service.startRunFromWebhook(eligibleInput());

    expect(captures.reserveIfArmed).toHaveBeenCalledOnce();
    expect(captures.reserveIfArmed).toHaveBeenCalledWith(PROJECT_ID, 'run-1');
    expect(result.isNew).toBe(true);
    expect(result.run.experimentCaptureId).toBe('capture-1');
  });

  it('sin captura armada el Run vuelve idéntico al camino normal', async () => {
    const created = buildRun();
    repository.create.mockResolvedValue(created);

    const result = await service.startRunFromWebhook(eligibleInput());

    expect(captures.reserveIfArmed).toHaveBeenCalledOnce();
    expect(result).toEqual({ run: created, isNew: true });
    expect(result.run.experimentCaptureId).toBeNull();
  });

  it('un borrador no consume la captura', async () => {
    repository.create.mockResolvedValue(buildRun({ draft: true }));

    const result = await service.startRunFromWebhook(eligibleInput({ draft: true }));

    expect(captures.reserveIfArmed).not.toHaveBeenCalled();
    expect(result.isNew).toBe(true);
  });

  it.each([
    ['false (PR anterior al vínculo)', false],
    ['null (sin clasificar)', null],
    ['ausente', undefined],
  ])('un Run con repositoryBindingEligible %s no consume la captura', async (_label, eligible) => {
    repository.create.mockResolvedValue(buildRun());

    await service.startRunFromWebhook(eligibleInput({ repositoryBindingEligible: eligible }));

    expect(captures.reserveIfArmed).not.toHaveBeenCalled();
  });

  it('un evento duplicado o un HEAD sin cambios (isNew false) no consume la captura', async () => {
    const existing = buildRun({ headSha: 'head-sha-1', status: 'PROCESSING' });
    repository.findCurrentByPullRequest.mockResolvedValue(existing);

    const result = await service.startRunFromWebhook(eligibleInput());

    expect(repository.create).not.toHaveBeenCalled();
    expect(captures.reserveIfArmed).not.toHaveBeenCalled();
    expect(result).toEqual({ run: existing, isNew: false });
  });

  it('un nuevo HEAD del mismo PR crea otro Run que sí se evalúa (la captura decide si sigue armada)', async () => {
    repository.findCurrentByPullRequest.mockResolvedValue(buildRun({ headSha: 'old', status: 'PROCESSING' }));
    repository.transitionCurrent.mockResolvedValue(buildRun({ status: 'OBSOLETE', current: false }));
    repository.create.mockResolvedValue(buildRun({ id: 'run-2', headSha: 'head-sha-2' }));
    captures.reserveIfArmed.mockResolvedValue(null);

    const result = await service.startRunFromWebhook(eligibleInput({ headSha: 'head-sha-2' }));

    expect(captures.reserveIfArmed).toHaveBeenCalledWith(PROJECT_ID, 'run-2');
    expect(result.run.id).toBe('run-2');
    expect(result.run.experimentCaptureId).toBeNull();
  });

  it('si el reservador lanza un error inesperado, el Run se crea normal y no se propaga el fallo', async () => {
    const created = buildRun();
    repository.create.mockResolvedValue(created);
    captures.reserveIfArmed.mockRejectedValue(new Error('connection reset with secret-material'));

    const result = await service.startRunFromWebhook(eligibleInput());

    expect(result).toEqual({ run: created, isNew: true });
    expect(result.run.experimentCaptureId).toBeNull();
  });

  it('el webhook deja de reservar cuando la captura ya fue consumida (reservador sin filas)', async () => {
    repository.create.mockResolvedValue(buildRun({ id: 'run-2' }));
    captures.reserveIfArmed.mockResolvedValue(null);

    const result = await service.startRunFromWebhook(eligibleInput());

    expect(captures.reserveIfArmed).toHaveBeenCalledOnce();
    expect(result.run.experimentCaptureId).toBeNull();
  });
});
