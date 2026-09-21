import { HttpStatus, Injectable } from '@nestjs/common';
import { ProjectsRepository } from './projects.repository.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Project } from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';
import type { WorkspaceRefResponse } from '../workspaces/dto/workspace.response.js';
import { assertPersonalWorkspace } from '../workspaces/personal-workspace.util.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';

const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly workspacesService: WorkspacesService,
  ) {}

  /**
   * HU63: hasta el corte 3 solo se crean Projects personales (`workspaceId`
   * omitido o el propio id numérico); cualquier otro responde `404`.
   */
  async create(dto: CreateProjectDto, ownerUserId: string, githubUserId: string): Promise<ProjectResponse> {
    assertPersonalWorkspace(dto.workspaceId, githubUserId);

    const project = await this.projectsRepository.create(dto.name.trim(), ownerUserId);
    return this.toResponse(project, await this.workspacesService.personalRef(ownerUserId, githubUserId));
  }

  async getById(id: string, ownerUserId: string, githubUserId: string): Promise<ProjectResponse> {
    const project = await this.projectsRepository.findById(id, ownerUserId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toResponse(project, await this.workspacesService.personalRef(ownerUserId, githubUserId));
  }

  /** HU56: borrado lógico; ajeno, inexistente o ya borrado responden igual (`404`). */
  async delete(id: string, ownerUserId: string): Promise<void> {
    const deleted = await this.projectsRepository.softDelete(id, ownerUserId);

    if (!deleted) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async list(
    limit: number | undefined,
    cursor: string | undefined,
    ownerUserId: string,
    githubUserId: string,
    workspaceId?: string,
  ): Promise<Page<ProjectResponse>> {
    // Hasta el corte 3 los únicos Projects visibles son los personales del creador.
    assertPersonalWorkspace(workspaceId, githubUserId);

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const projects = await this.projectsRepository.findAll(take, ownerUserId, cursor);
    const hasMore = projects.length > take;
    const personal = await this.workspacesService.personalRef(ownerUserId, githubUserId);
    const items = (hasMore ? projects.slice(0, take) : projects).map((project) =>
      this.toResponse(project, personal),
    );

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /**
   * `role` es interino (`ADMIN`, el predicado del creador): en un Project
   * personal es el comportamiento final; la derivación por organización llega
   * con el corte 3. `workspace` sale de las columnas del Project o, si son
   * nulas (personal), de la referencia del workspace personal del usuario.
   */
  private toResponse(project: Project, personal: WorkspaceRefResponse): ProjectResponse {
    const workspace: WorkspaceRefResponse =
      project.githubOrgId !== null && project.githubOrgLogin !== null
        ? { kind: 'ORGANIZATION', id: project.githubOrgId, login: project.githubOrgLogin }
        : personal;

    return {
      id: project.id,
      name: project.name,
      currentVersionId: project.currentVersionId,
      workspace,
      role: 'ADMIN',
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
