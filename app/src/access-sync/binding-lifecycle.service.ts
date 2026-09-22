import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { UserGithubIdentitiesRepository } from '../common/auth/user-github-identities.repository.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { ProjectSubscriptionsService } from '../realtime/project-subscriptions.service.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import type { Project, RepositoryBinding } from '../generated/prisma/client.js';
import { REVOKE_CONCURRENCY } from './access-sync.constants.js';

/**
 * Transiciones del binding que dispara la sincronización con GitHub (HU61): eventos
 * `repository` e `installation`/`installation_repositories` y la reconciliación (c).
 * Un binding que pasa a `REVOKED` pierde también los registros Maintainer y Reader del
 * Project (borrados con `ProjectAccessService.revoke`, que toma el mismo advisory lock por
 * `(projectId, userId)` que el alta y las reverificaciones) y se expulsa de las salas
 * WebSocket a quien ya no ve el Project. Los Admin conservan su registro: un Admin sigue
 * viendo el Project con el binding `REVOKED` para reactivarlo o eliminarlo.
 */
@Injectable()
export class BindingLifecycleService {
  private readonly logger = new Logger(BindingLifecycleService.name);

  constructor(
    private readonly bindings: RepositoryBindingsRepository,
    private readonly accessRepository: ProjectAccessRepository,
    private readonly access: ProjectAccessService,
    private readonly subscriptions: ProjectSubscriptionsService,
    private readonly identities: UserGithubIdentitiesRepository,
  ) {}

  /**
   * Pasa el binding a `REVOKED` (sin borrar evidencia) y limpia los accesos no Admin.
   * Idempotente: repetirlo (evento duplicado o tardío, o un binding ya `REVOKED`) solo
   * vuelve a limpiar lo que hubiera quedado. El estado se cambia ANTES de borrar: un alta
   * que corre después ve el binding `REVOKED` y no concede Maintainer/Reader; una que ya
   * estaba en vuelo termina antes de que este borrado tome su lock.
   */
  async revokeBinding(binding: Pick<RepositoryBinding, 'id' | 'projectId' | 'status'>): Promise<void> {
    if (binding.status !== 'REVOKED') {
      await this.bindings.updateStatus(binding.id, 'REVOKED');
    }

    await this.dropNonAdminAccess(binding.projectId);
  }

  /**
   * Borra los registros Maintainer/Reader y expulsa los sockets sin acceso. Un fallo al
   * borrar un usuario no impide los demás ni la expulsión; se informa al final para que
   * quien lo invoca lo registre (la reconciliación termina lo que quede: los bindings
   * `REVOKED` con registros sobrantes, y el predicado de acceso ya los deniega).
   */
  dropNonAdminAccess(projectId: string): Promise<void> {
    return this.dropAccess(projectId, false);
  }

  /**
   * Oculta el Project (ciclo de vida de la organización: desaparece, se desinstala la App o
   * queda sin owners): binding `REVOKED` si lo tiene (sin borrar evidencia) y borrado de TODOS
   * los registros, Admin incluido, porque la organización ya no puede verificarse. El Project y su
   * evidencia se conservan. Reaparece, con el binding `REVOKED` hasta que un Admin lo reactive
   * (`POST .../enable`), cuando el alta vuelve a crear el acceso al entrar. Idempotente.
   */
  async hideProject(projectId: string): Promise<void> {
    const binding = await this.bindings.findByProjectId(projectId);

    if (binding && binding.status !== 'REVOKED') {
      await this.bindings.updateStatus(binding.id, 'REVOKED');
    }

    await this.dropAccess(projectId, true);
  }

  private async dropAccess(projectId: string, includeAdmin: boolean): Promise<void> {
    const userIds = includeAdmin
      ? await this.accessRepository.findAllUserIds(projectId)
      : await this.accessRepository.findNonAdminUserIds(projectId);
    const failed: string[] = [];

    await mapWithConcurrency(userIds, REVOKE_CONCURRENCY, async (userId) => {
      try {
        await this.access.revoke(projectId, userId);
      } catch (error) {
        failed.push(userId);
        this.logger.warn(`No se pudo borrar el acceso de "${userId}" al Project "${projectId}": ${describe(error)}`);
      }
    });

    try {
      await this.subscriptions.revalidateProject(projectId);
    } catch (error) {
      failed.push('sockets');
      this.logger.warn(`No se pudo revalidar las suscripciones del Project "${projectId}": ${describe(error)}`);
    }

    if (failed.length > 0) {
      throw new Error(`Revocación incompleta del Project "${projectId}" (${failed.length} pendientes).`);
    }
  }

  /**
   * Id de GitHub que debe ser propietario del repositorio: la organización del Project o,
   * en un Project personal, el creador (el `githubUserId` ya persistido; sin identidad no se
   * puede comparar y devuelve `null`, nunca se infiere una transferencia).
   */
  async expectedOwnerId(project: Pick<Project, 'ownerUserId' | 'githubOrgId'>): Promise<string | null> {
    if (project.githubOrgId !== null) {
      return project.githubOrgId;
    }

    if (project.ownerUserId === null) {
      return null;
    }

    return (await this.identities.findByUserId(project.ownerUserId))?.githubUserId ?? null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
