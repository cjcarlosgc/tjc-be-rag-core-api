import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AnalysisRunsRepository,
  type CreateAnalysisRunInput,
} from './analysis-runs.repository.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type {
  AnalysisIndexMode,
  AnalysisRun,
  AnalysisRunStatus,
  PullRequestState,
} from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';

export interface StartRunResult {
  run: AnalysisRun;
  isNew: boolean;
}

export interface SnapshotPatch {
  indexMode: AnalysisIndexMode;
  indexDeltaBaseSha: string | null;
  projectVersionId: string;
}

const NON_TERMINAL_STATUSES: AnalysisRunStatus[] = ['QUEUED', 'PROCESSING', 'ACTION_REQUIRED'];

export type AnalysisRunCompletionStatus =
  | 'SUCCESS'
  | 'BEHAVIORAL_MISMATCH'
  | 'TECHNICAL_GENERATION_FAILURE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'BASELINE_FAILED'
  | 'NO_ADDITIONAL_TESTS_REQUIRED'
  | 'NO_TEST_RELEVANT_CHANGES';

export interface CompleteAnalysisRunPatch {
  resultSummary?: string;
  functionalBehaviorValidated?: boolean;
  generatedTestsCount?: number;
}

const DEFAULT_PAGE_LIMIT = 20;

/**
 * HU32: transiciones válidas del estado conceptual de un AnalysisRun
 * (`spec/contracts/system-contract.md`, "Estados conceptuales"). `OBSOLETE`
 * es alcanzable desde cualquier estado no terminal-obsoleto: un HEAD nuevo
 * invalida el Run vigente sin importar en qué status estuviera.
 */
const TRANSITIONS: Record<AnalysisRunStatus, AnalysisRunStatus[]> = {
  QUEUED: ['PROCESSING', 'OBSOLETE'],
  PROCESSING: [
    'ACTION_REQUIRED',
    'SUCCESS',
    'BEHAVIORAL_MISMATCH',
    'TECHNICAL_GENERATION_FAILURE',
    'INFRASTRUCTURE_FAILURE',
    'BASELINE_FAILED',
    'NO_ADDITIONAL_TESTS_REQUIRED',
    'NO_TEST_RELEVANT_CHANGES',
    'OBSOLETE',
  ],
  ACTION_REQUIRED: ['PROCESSING', 'OBSOLETE'],
  SUCCESS: ['OBSOLETE'],
  BEHAVIORAL_MISMATCH: ['OBSOLETE'],
  TECHNICAL_GENERATION_FAILURE: ['OBSOLETE'],
  INFRASTRUCTURE_FAILURE: ['OBSOLETE'],
  BASELINE_FAILED: ['OBSOLETE'],
  NO_ADDITIONAL_TESTS_REQUIRED: ['OBSOLETE'],
  NO_TEST_RELEVANT_CHANGES: ['OBSOLETE'],
  OBSOLETE: [],
};

@Injectable()
export class AnalysisRunsService {
  constructor(
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * Crea el Run para un HEAD dado. Si ya existe un Run vigente para el mismo
   * PR con el mismo HEAD, lo devuelve sin duplicar (identidad lógica única
   * por Project/Repository/PR/HEAD). Si el HEAD difiere, obsoleta el Run
   * vigente anterior -sin importar su status- y crea uno nuevo.
   */
  async startRun(input: CreateAnalysisRunInput, ownerUserId: string): Promise<AnalysisRun> {
    await this.findProjectOrThrow(input.projectId, ownerUserId);
    return (await this.startRunInternal(input)).run;
  }

  /**
   * Igual que `startRun` pero sin scope de owner: la usa el ingress de
   * GitHub (HU31), que ya autorizó la operación vía firma de webhook +
   * binding ENABLED, no vía un usuario autenticado. Devuelve `isNew` para
   * que el caller (HU33/34) solo encole el job de snapshot intelligence
   * cuando de verdad se creó un Run -no en el caso idempotente de HEAD sin
   * cambios, que devuelve el mismo Run existente-.
   */
  async startRunFromWebhook(input: CreateAnalysisRunInput): Promise<StartRunResult> {
    return this.startRunInternal(input);
  }

  /**
   * Cierra la vigencia del Run actual de un PR sin borrar historial (HU31,
   * lifecycle de PR). Trabajo no terminal pasa a OBSOLETE; un Run ya
   * terminal (p. ej. SUCCESS) solo deja de ser `current` -sus resultados no
   * pueden publicarse como vigentes tras el cierre- sin perder su status.
   * `prState` es opcional: `converted_to_draft` no cambia el estado del PR.
   */
  async closeRun(run: AnalysisRun, prState?: Extract<PullRequestState, 'CLOSED' | 'MERGED'>): Promise<AnalysisRun> {
    const patch: Record<string, unknown> = { current: false, ...(prState ? { prState } : {}) };

    if (NON_TERMINAL_STATUSES.includes(run.status)) {
      return this.transitionTo(run, 'OBSOLETE', patch);
    }

    return this.analysisRunsRepository.update(run.id, patch);
  }

  /** HU33/34: arranca el procesamiento de snapshot intelligence. */
  async startProcessing(run: AnalysisRun): Promise<AnalysisRun> {
    return this.transitionTo(run, 'PROCESSING', {});
  }

  /**
   * HU33: registra el resultado del cálculo de CHANGESET/INDEX DELTA y el
   * `ProjectVersion` que produjo. No es una transición de estado -el Run
   * sigue en PROCESSING mientras baseline/retrieval/generación (cortes
   * futuros) no se hayan ejecutado-.
   */
  async recordSnapshot(run: AnalysisRun, patch: SnapshotPatch): Promise<AnalysisRun> {
    return this.analysisRunsRepository.update(run.id, patch);
  }

  /**
   * Gemelo sin scope de owner de `completeRun`, para el job handler de
   * snapshot intelligence (HU33/34): cierra el Run como
   * `NO_TEST_RELEVANT_CHANGES` cuando el CHANGESET no toca código fuente, o
   * como `INFRASTRUCTURE_FAILURE` si falla la llamada a la API de GitHub.
   */
  async completeRunFromSystem(
    run: AnalysisRun,
    status: AnalysisRunCompletionStatus,
    patch: CompleteAnalysisRunPatch,
  ): Promise<AnalysisRun> {
    return this.transitionTo(run, status, { ...patch, completedAt: new Date() });
  }

  private async startRunInternal(input: CreateAnalysisRunInput): Promise<StartRunResult> {
    const current = await this.analysisRunsRepository.findCurrentByPullRequest(
      input.projectId,
      input.repositoryId,
      input.prNumber,
    );

    if (current && current.headSha === input.headSha) {
      return { run: current, isNew: false };
    }

    if (current) {
      await this.transitionTo(current, 'OBSOLETE', { current: false });
    }

    const run = await this.analysisRunsRepository.create(input);
    return { run, isNew: true };
  }

  async requestContinuation(runId: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);

    if (run.status !== 'ACTION_REQUIRED') {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_INVALID_TRANSITION,
        `El AnalysisRun "${run.id}" no puede continuar desde "${run.status}"; solo aplica desde ACTION_REQUIRED.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.transitionTo(run, 'PROCESSING', { attemptCount: run.attemptCount + 1 });
  }

  async markActionRequired(runId: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);
    return this.markActionRequiredFromSystem(run);
  }

  /**
   * Gemelo sin scope de owner de `markActionRequired`, para el job handler
   * de snapshot intelligence / continuation (HU35/36): el `run` ya viene
   * resuelto por el job, que no tiene un usuario autenticado.
   */
  async markActionRequiredFromSystem(run: AnalysisRun): Promise<AnalysisRun> {
    return this.transitionTo(run, 'ACTION_REQUIRED', {
      actionRequiredCount: run.actionRequiredCount + 1,
    });
  }

  async completeRun(
    runId: string,
    status: AnalysisRunCompletionStatus,
    patch: CompleteAnalysisRunPatch,
    ownerUserId: string,
  ): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);
    return this.transitionTo(run, status, { ...patch, completedAt: new Date() });
  }

  async obsoleteRun(runId: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.findRunOrThrow(runId, ownerUserId);

    if (run.status === 'OBSOLETE') {
      return run;
    }

    return this.transitionTo(run, 'OBSOLETE', { current: false });
  }

  async getById(id: string, ownerUserId: string): Promise<AnalysisRun> {
    return this.findRunOrThrow(id, ownerUserId);
  }

  async listByProject(
    projectId: string,
    status: AnalysisRunStatus | undefined,
    limit: number | undefined,
    cursor: string | undefined,
    ownerUserId: string,
  ): Promise<Page<AnalysisRun>> {
    await this.projectAccess.require(ownerUserId, projectId, 'READER');

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const runs = await this.analysisRunsRepository.findByProjectForOwner(
      projectId,
      ownerUserId,
      take,
      status,
      cursor,
    );
    const hasMore = runs.length > take;
    const items = hasMore ? runs.slice(0, take) : runs;

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /**
   * HU55: Runs de todos los Projects visibles para el usuario (cualquier rol): los
   * personales que creó más los de organización con registro de acceso ya existente. No
   * verifica contra GitHub ni da de alta nada (`INTEROP-2.4` §6.10).
   */
  async listVisible(
    status: AnalysisRunStatus | undefined,
    limit: number | undefined,
    cursor: string | undefined,
    userId: string,
  ): Promise<Page<AnalysisRun>> {
    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const runs = await this.analysisRunsRepository.findVisibleForUser(userId, take, status, cursor);
    const hasMore = runs.length > take;
    const items = hasMore ? runs.slice(0, take) : runs;

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  private async transitionTo(
    run: AnalysisRun,
    status: AnalysisRunStatus,
    patch: Record<string, unknown>,
  ): Promise<AnalysisRun> {
    const allowed = TRANSITIONS[run.status];

    if (!allowed.includes(status)) {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_INVALID_TRANSITION,
        `El AnalysisRun "${run.id}" no puede pasar de "${run.status}" a "${status}".`,
        HttpStatus.CONFLICT,
      );
    }

    return this.analysisRunsRepository.update(run.id, { status, ...patch });
  }

  private async findProjectOrThrow(projectId: string, ownerUserId: string): Promise<void> {
    const project = await this.projectsRepository.findById(projectId, ownerUserId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${projectId}".`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async findRunOrThrow(id: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.analysisRunsRepository.findByIdForOwner(id, ownerUserId);

    if (!run) {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_NOT_FOUND,
        `No existe un AnalysisRun con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return run;
  }
}
