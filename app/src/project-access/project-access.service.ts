import { Inject, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { GithubIdentityService } from '../common/auth/github-identity.service.js';
import { isRoleAtLeast } from '../common/persistence/accessible-project.filter.js';
import {
  GITHUB_ACCESS_PORT,
  type GithubAccessPort,
  type RepositoryPermissionLevel,
} from '../github-app/github-access.port.js';
import type { Project, ProjectRole } from '../generated/prisma/client.js';
import { OrganizationAccessResolver, VerificationContext } from './organization-access.resolver.js';
import { ACCESS_VERIFICATION_BUDGET, ACCESS_VERIFICATION_CONCURRENCY } from './project-access.constants.js';
import {
  githubVerificationUnavailable,
  projectNotFound,
  projectRoleInsufficient,
  resourceNotFound,
  type ProjectResourceKind,
} from './project-access.errors.js';
import { ProjectAccessRepository, type ProjectWithBinding } from './project-access.repository.js';

/** Resultado de `require`: el Project (ya cargado) y el rol del usuario sobre él. */
export interface AccessGrant {
  project: Project;
  role: ProjectRole;
}

/** Veredicto de una verificación viva (o de un registro vigente) de un `(Project, usuario)`. */
export type AccessVerdict =
  | { status: 'GRANTED'; role: ProjectRole }
  /** GitHub confirma que no hay acceso (o el Project no es de organización): `404`. */
  | { status: 'DENIED' }
  /** GitHub no permite verificar: conservar lo registrado, no conceder lo nuevo (`503` / omitido). */
  | { status: 'UNVERIFIABLE' };

/**
 * Resultado de reverificar un registro existente: `UPDATED` cambió el rol, `REVOKED` lo borró
 * porque GitHub confirma que el acceso se perdió, `UNVERIFIABLE` lo conservó porque GitHub no
 * pudo verificarse, `NO_RECORD` no había nada que reverificar (el alta lo crea al entrar).
 */
export type ReverifyOutcome = 'UNCHANGED' | 'UPDATED' | 'REVOKED' | 'UNVERIFIABLE' | 'NO_RECORD';

export interface OrganizationSyncTarget {
  organizationId: string;
  role: 'ADMIN' | 'MEMBER';
}

/** `PrismaClientKnownRequestError` de una transacción interactiva que expira o no obtiene conexión. */
function isTransactionTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2028';
}

/**
 * HU59/HU60: acceso derivado de GitHub a un Project. `require` cubre el borde de cada
 * petición (`014/plan.md`, "Predicado de acceso"): personal ajeno -> `404` sin GitHub;
 * organización con registro suficiente (y binding no `REVOKED` salvo Admin) -> continúa;
 * registro insuficiente -> `403`; sin registro -> verificación viva y alta, o `404`/`503`.
 * El registro no tiene TTL ni caché: rige hasta que un evento o la reconciliación lo cambia.
 */
@Injectable()
export class ProjectAccessService {
  private readonly logger = new Logger(ProjectAccessService.name);

  constructor(
    private readonly repository: ProjectAccessRepository,
    private readonly organizations: OrganizationAccessResolver,
    private readonly githubIdentity: GithubIdentityService,
    @Inject(GITHUB_ACCESS_PORT) private readonly github: GithubAccessPort,
  ) {}

  /**
   * Exige al menos `minRole` sobre el Project. No visible (inexistente, borrado, personal
   * ajeno, colaborador externo, sin permiso) -> `404 PROJECT_NOT_FOUND`; visible con rol
   * menor -> `403 PROJECT_ROLE_INSUFFICIENT`; acceso nuevo no verificable -> `503`.
   */
  async require(userId: string, projectId: string, minRole: ProjectRole = 'READER'): Promise<AccessGrant> {
    const visible = await this.repository.findVisible(projectId, userId);

    if (visible) {
      // Personal: su creador, siempre Admin. Organización: el rol del registro (existe por el predicado).
      const role = visible.githubOrgId === null ? 'ADMIN' : (visible.access[0]?.role ?? 'READER');
      return this.authorize(visible, role, minRole);
    }

    const project = await this.repository.findLive(projectId);

    // Un Project personal de otra persona responde 404 sin verificar nada.
    if (!project || project.githubOrgId === null) {
      throw projectNotFound(projectId);
    }

    const githubUserId = await this.githubIdentity.resolve(userId);
    const verdict = await this.grantOnEntry(projectId, userId, githubUserId, new VerificationContext());

    if (verdict.status === 'UNVERIFIABLE') {
      throw githubVerificationUnavailable();
    }

    if (verdict.status === 'DENIED') {
      throw projectNotFound(projectId);
    }

    return this.authorize(project, verdict.role, minRole);
  }

  /**
   * Alta por deep link (`INTEROP-2.4` §6.13): resuelve el `projectId` del recurso
   * descendiente (Run, versión, pregunta, publicación, experimento, target) y aplica
   * `require` sobre ese Project, de modo que un miembro con acceso al repositorio entra
   * por id o enlace con el mismo predicado que por el Project. No visible (recurso
   * inexistente, Project ajeno, borrado o sin acceso) responde el `404` PROPIO del recurso,
   * sin distinguir un id inexistente; rol menor `403`; acceso nuevo no verificable `503`.
   */
  async requireForResource(
    userId: string,
    resource: ProjectResourceKind,
    resourceId: string,
    minRole: ProjectRole = 'READER',
  ): Promise<AccessGrant> {
    if (resource === 'project') {
      return this.require(userId, resourceId, minRole);
    }

    const projectId = await this.repository.findProjectIdOf(resource, resourceId);

    if (projectId === null) {
      throw resourceNotFound(resource, resourceId);
    }

    try {
      return await this.require(userId, projectId, minRole);
    } catch (error) {
      if (error instanceof AppException && error.code === ErrorCode.PROJECT_NOT_FOUND) {
        throw resourceNotFound(resource, resourceId);
      }
      throw error;
    }
  }

  /**
   * Alta al entrar: verificación viva bajo el advisory lock de `(projectId, userId)` y upsert
   * del registro en la misma transacción. Un alta nunca sobrescribe ni recrea una
   * revocación posterior al inicio de su verificación: revocaciones y reverificaciones
   * toman el mismo lock, así que el resultado de esta verificación nunca puede ser más
   * antiguo que el de otra que la sucedió. Un registro que ya da visibilidad se reutiliza
   * sin volver a GitHub (otra alta concurrente lo creó mientras se esperaba el lock).
   */
  async grantOnEntry(
    projectId: string,
    userId: string,
    githubUserId: string,
    context: VerificationContext = new VerificationContext(),
  ): Promise<AccessVerdict> {
    try {
      return await this.repository.withAccessLock(projectId, userId, async (scope) => {
        const project = await scope.findProject();

        if (!project || project.githubOrgId === null) {
          return { status: 'DENIED' };
        }

        const existing = await scope.findRecord();

        // Maintainer/Reader solo con un binding existente y no `REVOKED` (mismo criterio que el predicado).
        const bindingAllowsAccess = project.repositoryBinding !== null && project.repositoryBinding.status !== 'REVOKED';

        if (existing && (existing.role === 'ADMIN' || bindingAllowsAccess)) {
          return { status: 'GRANTED', role: existing.role };
        }

        const verdict = await this.deriveRole(project, githubUserId, context);

        if (verdict.status === 'GRANTED') {
          // Maintainer/Reader dependen del binding: se confirma justo antes del upsert con
          // `FOR SHARE`, de modo que un binding que pasó a `REVOKED` (evento o reconciliación,
          // que borran los registros DESPUÉS de cambiar el estado) no recibe un registro creado
          // con el estado anterior; una transición en vuelo espera a este commit y luego lo borra.
          if (verdict.role !== 'ADMIN') {
            const bindingStatus = await scope.lockBindingStatus();

            if (bindingStatus === null || bindingStatus === 'REVOKED') {
              return { status: 'DENIED' };
            }
          }

          await scope.upsertRecord(verdict.role);
        }

        return verdict;
      });
    } catch (error) {
      if (isTransactionTimeout(error)) {
        this.logger.warn(`El alta de acceso de "${projectId}" excedió el tiempo de la transacción; no verificable.`);
        return { status: 'UNVERIFIABLE' };
      }
      throw error;
    }
  }

  /**
   * Revocación del registro bajo el MISMO advisory lock que el alta y las reverificaciones
   * (la usa el corte 5b desde eventos y reconciliación): si un alta estaba en vuelo, este
   * borrado corre después de su commit y gana; ningún alta recrea el acceso revocado.
   */
  async revoke(projectId: string, userId: string): Promise<void> {
    await this.repository.withAccessLock(projectId, userId, (scope) => scope.deleteRecord());
  }

  /**
   * Reverificación de un registro EXISTENTE (`ACCESS_REVERIFY` y reconciliación (b)): las
   * mismas reglas que el alta (`deriveRole`, lectura viva del installation token; el payload de
   * un evento nunca aporta el rol) bajo el MISMO advisory lock por `(projectId, userId)`, de
   * modo que nunca se intercala con un alta ni con una revocación. Confirma y actualiza
   * `role`/`verifiedAt`; borra el registro si GitHub confirma que se perdió el acceso (no
   * miembro activo, App desinstalada de la organización, permiso ausente, Project borrado o
   * binding `REVOKED` para un Maintainer/Reader); lo conserva si no puede verificar (nunca
   * revoca por un error de red). Un registro inexistente se deja tal cual: solo el alta al
   * entrar concede accesos nuevos.
   */
  async reverify(
    projectId: string,
    userId: string,
    githubUserId: string,
    context: VerificationContext = new VerificationContext(),
  ): Promise<ReverifyOutcome> {
    try {
      return await this.repository.withAccessLock(projectId, userId, async (scope): Promise<ReverifyOutcome> => {
        const existing = await scope.findRecord();

        if (!existing) {
          return 'NO_RECORD';
        }

        const project = await scope.findProject();

        // Project borrado (o no de organización): el registro ya no tiene sentido.
        if (!project || project.githubOrgId === null) {
          await scope.deleteRecord();
          return 'REVOKED';
        }

        const verdict = await this.deriveRole(project, githubUserId, context);

        if (verdict.status === 'UNVERIFIABLE') {
          return 'UNVERIFIABLE';
        }

        if (verdict.status === 'GRANTED' && verdict.role !== 'ADMIN') {
          // Como en el alta, Maintainer/Reader dependen del binding: se confirma con `FOR SHARE`.
          const bindingStatus = await scope.lockBindingStatus();

          if (bindingStatus === null || bindingStatus === 'REVOKED') {
            await scope.deleteRecord();
            return 'REVOKED';
          }
        }

        if (verdict.status === 'DENIED') {
          await scope.deleteRecord();
          return 'REVOKED';
        }

        await scope.upsertRecord(verdict.role);
        return existing.role === verdict.role ? 'UNCHANGED' : 'UPDATED';
      });
    } catch (error) {
      if (isTransactionTimeout(error)) {
        this.logger.warn(`La reverificación de "${projectId}" excedió el tiempo de la transacción; no verificable.`);
        return 'UNVERIFIABLE';
      }
      throw error;
    }
  }

  /**
   * Alta de los Projects de organización que el usuario aún no ve (candidatos de
   * `GET /projects`), con tope de concurrencia y presupuesto por petición. Agotado el
   * presupuesto los restantes se omiten sin fallar; un candidato no verificable o con
   * error se omite y nunca revoca nada. No memoiza denegaciones.
   */
  async syncOrganizationProjects(
    userId: string,
    githubUserId: string,
    organizations: OrganizationSyncTarget[],
    context: VerificationContext,
  ): Promise<void> {
    const candidates = await this.repository.findUnseenOrganizationProjects(
      userId,
      organizations.filter((organization) => organization.role === 'ADMIN').map((organization) => organization.organizationId),
      organizations.filter((organization) => organization.role === 'MEMBER').map((organization) => organization.organizationId),
      ACCESS_VERIFICATION_BUDGET + 1,
    );
    const verifiable = candidates.slice(0, ACCESS_VERIFICATION_BUDGET);

    if (candidates.length > verifiable.length) {
      this.logger.warn(
        `Presupuesto de verificaciones agotado: hay Projects de organización sin verificar en esta petición.`,
      );
    }

    await mapWithConcurrency(verifiable, ACCESS_VERIFICATION_CONCURRENCY, async (candidate) => {
      try {
        await this.grantOnEntry(candidate.id, userId, githubUserId, context);
      } catch (error) {
        this.logger.warn(
          `No se pudo verificar el acceso al Project "${candidate.id}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private authorize(project: Project, role: ProjectRole, minRole: ProjectRole): AccessGrant {
    if (!isRoleAtLeast(role, minRole)) {
      throw projectRoleInsufficient(minRole, role);
    }

    return { project, role };
  }

  /**
   * Rol derivado de GitHub, siempre con una lectura viva del installation token: owner de
   * la organización = Admin; miembro activo con permiso `maintain`/`write`/`admin` sobre el
   * repositorio vinculado = Maintainer, con `triage`/`read` = Reader. La membresía activa se
   * exige SIEMPRE (un colaborador externo con `write` no accede, ni en repositorios
   * privados, internal o públicos: el `read` implícito de un repositorio público no cuenta).
   * Un Project sin repositorio o con binding `REVOKED` solo lo ve un Admin.
   */
  private async deriveRole(
    project: ProjectWithBinding,
    githubUserId: string,
    context: VerificationContext,
  ): Promise<AccessVerdict> {
    const organization = await this.organizations.resolve(project.githubOrgId as string, githubUserId, context);

    if (organization.status === 'UNVERIFIABLE') {
      return { status: 'UNVERIFIABLE' };
    }

    // No miembro activo o App desinstalada (no es una caída): el Project no se ve (404).
    if (organization.status !== 'OK') {
      return { status: 'DENIED' };
    }

    if (organization.organization.role === 'ADMIN') {
      return { status: 'GRANTED', role: 'ADMIN' };
    }

    const binding = project.repositoryBinding;

    if (!binding || binding.status === 'REVOKED') {
      return { status: 'DENIED' };
    }

    const permission = await this.github.getRepositoryPermission(
      { installationId: organization.organization.installationId, repositoryName: binding.repositoryName },
      githubUserId,
    );

    switch (permission.status) {
      case 'OK':
        return { status: 'GRANTED', role: roleForPermission(permission.value) };
      case 'UNVERIFIABLE':
        return { status: 'UNVERIFIABLE' };
      default:
        return { status: 'DENIED' };
    }
  }
}

/** `maintain`/`write`/`admin` -> Maintainer; `triage`/`read` -> Reader. */
export function roleForPermission(permission: RepositoryPermissionLevel): ProjectRole {
  return permission === 'admin' || permission === 'maintain' || permission === 'write' ? 'MAINTAINER' : 'READER';
}
