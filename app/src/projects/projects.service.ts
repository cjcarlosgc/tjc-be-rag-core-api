import { Injectable } from '@nestjs/common';
import { ProjectsRepository } from './projects.repository.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';
import type { Project, ProjectRole } from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';
import type { WorkspaceRefResponse } from '../workspaces/dto/workspace.response.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { ProjectSubscriptionsService } from '../realtime/project-subscriptions.service.js';
import { OrganizationAccessResolver, VerificationContext } from '../project-access/organization-access.resolver.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import {
  githubVerificationUnavailable,
  projectNotFound,
  workspaceAdminRequired,
  workspaceNotFound,
} from '../project-access/project-access.errors.js';

const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly workspacesService: WorkspacesService,
    private readonly projectAccess: ProjectAccessService,
    private readonly projectAccessRepository: ProjectAccessRepository,
    private readonly organizations: OrganizationAccessResolver,
    private readonly subscriptions: ProjectSubscriptionsService,
  ) {}

  /**
   * HU63: `workspaceId` omitido o el propio id numérico = Project personal (el creador es su
   * único usuario y su Admin). Con el id de una organización solo crea un owner activo,
   * verificado en vivo con el installation token: no es un workspace del usuario `404
   * WORKSPACE_NOT_FOUND`, miembro que no es owner `403 WORKSPACE_ADMIN_REQUIRED`, GitHub sin
   * respuesta `503` (no se concede lo nuevo). El Project de organización guarda el login
   * vigente y su registro `ADMIN` del creador entra en la misma transacción.
   */
  async create(dto: CreateProjectDto, userId: string, githubUserId: string): Promise<ProjectResponse> {
    const name = dto.name.trim();
    const workspace = await this.organizations.resolveWorkspace(dto.workspaceId, githubUserId);

    switch (workspace.status) {
      case 'NOT_FOUND':
        throw workspaceNotFound(dto.workspaceId as string);
      case 'UNVERIFIABLE':
        throw githubVerificationUnavailable();
      case 'ORGANIZATION': {
        if (workspace.organization.role !== 'ADMIN') {
          throw workspaceAdminRequired();
        }

        const project = await this.projectsRepository.createInOrganization(name, userId, {
          id: workspace.organization.organizationId,
          login: workspace.organization.login,
        });
        return this.toResponse(project, 'ADMIN', await this.workspacesService.personalRef(userId, githubUserId));
      }
      case 'PERSONAL': {
        const project = await this.projectsRepository.create(name, userId);
        return this.toResponse(project, 'ADMIN', await this.workspacesService.personalRef(userId, githubUserId));
      }
    }
  }

  async getById(id: string, userId: string, githubUserId: string): Promise<ProjectResponse> {
    const { project, role } = await this.projectAccess.require(userId, id, 'READER');
    return this.toResponse(project, role, await this.workspacesService.personalRef(userId, githubUserId));
  }

  /** HU63: renombrar, solo Admin (`403 PROJECT_ROLE_INSUFFICIENT` a otros roles visibles). */
  async update(id: string, dto: UpdateProjectDto, userId: string, githubUserId: string): Promise<ProjectResponse> {
    await this.projectAccess.require(userId, id, 'ADMIN');

    // El Admin pudo perder el acceso o el Project borrarse entre la comprobación y el renombre.
    if (!(await this.projectsRepository.rename(id, dto.name, userId))) {
      throw projectNotFound(id);
    }

    return this.getById(id, userId, githubUserId);
  }

  /** HU56/HU63: borrado lógico, solo Admin; no visible, inexistente o ya borrado responden `404`. */
  async delete(id: string, userId: string): Promise<void> {
    await this.projectAccess.require(userId, id, 'ADMIN');

    if (!(await this.projectsRepository.softDelete(id, userId))) {
      throw projectNotFound(id);
    }

    // Un Project borrado deja de ser visible para todos: se sacan los sockets suscritos a sus versiones.
    await this.subscriptions.revalidateProject(id);
  }

  /**
   * HU58/HU59: Projects visibles: los personales que creó el usuario y los de organización con
   * registro de acceso suficiente. Antes de listar, en una organización (todas las suyas sin
   * filtro, o la de `workspaceId`) se da de alta el acceso de los Projects vivos que aún no ve,
   * con tope de concurrencia y presupuesto; con GitHub sin respuesta el listado conserva lo
   * registrado y omite lo no verificable, sin fallar. Nunca devuelve Projects personales ajenos.
   */
  async list(
    limit: number | undefined,
    cursor: string | undefined,
    userId: string,
    githubUserId: string,
    workspaceId?: string,
  ): Promise<Page<ProjectResponse>> {
    const context = new VerificationContext();
    const filter = await this.prepareListing(userId, githubUserId, workspaceId, context);

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const projects = await this.projectsRepository.findAll(take, userId, cursor, filter);
    const hasMore = projects.length > take;
    const personal = await this.workspacesService.personalRef(userId, githubUserId);
    const items = (hasMore ? projects.slice(0, take) : projects).map((project) =>
      this.toResponse(project, project.githubOrgId === null ? 'ADMIN' : (project.access[0]?.role ?? 'READER'), personal),
    );

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /** Resuelve el filtro de workspace y da de alta los Projects de organización aún no vistos. */
  private async prepareListing(
    userId: string,
    githubUserId: string,
    workspaceId: string | undefined,
    context: VerificationContext,
  ): Promise<{ githubOrgId: string | null } | undefined> {
    if (workspaceId === undefined) {
      const memberships = await this.organizations.listMemberOrganizations(githubUserId, context);

      if (memberships.status === 'OK' && memberships.member.length > 0) {
        await this.projectAccess.syncOrganizationProjects(
          userId,
          githubUserId,
          memberships.member.map(({ organizationId, role }) => ({ organizationId, role })),
          context,
        );
      }

      return undefined;
    }

    const workspace = await this.organizations.resolveWorkspace(workspaceId, githubUserId, context);

    switch (workspace.status) {
      case 'PERSONAL':
        return { githubOrgId: null };
      case 'NOT_FOUND':
        throw workspaceNotFound(workspaceId);
      case 'UNVERIFIABLE': {
        // Sin poder verificar la pertenencia: si el usuario ya ve Projects de esa organización
        // por su registro, se listan; si no, no se puede saber si existe (503, nunca 404).
        const registered = await this.projectAccessRepository.findRegisteredOrganizations(userId);

        if (!registered.some((organization) => organization.organizationId === workspaceId)) {
          throw githubVerificationUnavailable();
        }

        return { githubOrgId: workspaceId };
      }
      case 'ORGANIZATION':
        await this.projectAccess.syncOrganizationProjects(
          userId,
          githubUserId,
          [{ organizationId: workspaceId, role: workspace.organization.role }],
          context,
        );
        return { githubOrgId: workspaceId };
    }
  }

  /**
   * `workspace` sale de las columnas del Project o, si son nulas (personal), de la referencia
   * del workspace personal del usuario; `role` es el rol del usuario autenticado en el Project.
   */
  private toResponse(project: Project, role: ProjectRole, personal: WorkspaceRefResponse): ProjectResponse {
    const workspace: WorkspaceRefResponse =
      project.githubOrgId !== null && project.githubOrgLogin !== null
        ? { kind: 'ORGANIZATION', id: project.githubOrgId, login: project.githubOrgLogin }
        : personal;

    return {
      id: project.id,
      name: project.name,
      currentVersionId: project.currentVersionId,
      workspace,
      role,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
