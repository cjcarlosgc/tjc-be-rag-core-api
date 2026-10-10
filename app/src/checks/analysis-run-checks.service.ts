import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { GithubChecksService } from '../github-app/github-checks.service.js';
import { mapRunStatusToCheckConclusion, buildCheckTitle } from './check-conclusion.util.js';
import type { AnalysisRun } from '../generated/prisma/client.js';

const DEFAULT_CHECK_NAME = 'RAG Core Analysis';

/**
 * HU39: publica la conclusión de un AnalysisRun como GitHub Check sobre su
 * `headSha`. Best-effort a propósito: un fallo publicando el Check nunca
 * revierte ni oculta que el Run ya terminó en Core -se loguea y se sigue-.
 */
@Injectable()
export class AnalysisRunChecksService {
  private readonly logger = new Logger(AnalysisRunChecksService.name);

  constructor(
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly githubChecksService: GithubChecksService,
    private readonly configService: ConfigService,
  ) {}

  async publishForRun(run: AnalysisRun): Promise<void> {
    const conclusion = mapRunStatusToCheckConclusion(run.status);

    if (!conclusion) {
      return;
    }

    try {
      const currentRun = await this.analysisRunsRepository.findById(run.id);

      if (
        !currentRun ||
        !currentRun.current ||
        currentRun.status !== run.status ||
        currentRun.headSha !== run.headSha
      ) {
        return;
      }

      const binding = await this.repositoryBindingsRepository.findForRun(currentRun);

      if (!binding) {
        return;
      }

      const { checkId } = await this.githubChecksService.createCheckRun(
        binding.installationId,
        binding.repositoryName,
        {
          name: this.configService.get<string>('GITHUB_CHECK_NAME', DEFAULT_CHECK_NAME),
          headSha: currentRun.headSha,
          conclusion,
          title: buildCheckTitle(currentRun.status),
          summary: currentRun.resultSummary ?? buildCheckTitle(currentRun.status),
          ...(this.buildDetailsUrl(currentRun) ? { detailsUrl: this.buildDetailsUrl(currentRun)! } : {}),
        },
      );

      // WI-CORE-026: la publicación se marca aunque GitHub no devuelva id (204); el id va si existe.
      await this.markCheckPublished(currentRun.id, checkId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido publicando el Check.';
      this.logger.warn(`No se pudo publicar el Check de GitHub para AnalysisRun ${run.id}: ${message}`);
    }
  }

  /** Best-effort: un fallo al escribir la marca no rompe el Run ni la publicación ya hecha en GitHub. */
  private async markCheckPublished(runId: string, checkId: string | null): Promise<void> {
    try {
      await this.analysisRunsRepository.markCheckPublished(runId, checkId);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'ErrorDesconocido';
      this.logger.warn(`Check publicado para AnalysisRun ${runId}, pero no se pudo registrar la marca (${reason}).`);
    }
  }

  private buildDetailsUrl(run: AnalysisRun): string | null {
    const base = this.configService.get<string>('CONSOLE_BASE_URL');

    if (!base) {
      return null;
    }

    return `${base.replace(/\/$/, '')}/projects/${run.projectId}/runs/${run.id}`;
  }
}
