import { Injectable, Logger } from '@nestjs/common';
import { BindingLifecycleService } from '../access-sync/binding-lifecycle.service.js';
import { RepositoryBindingsRepository, type BindingWithWorkspace } from '../repository-bindings/repository-bindings.repository.js';
import type { GithubRepositoryWebhookPayload } from './dto/repository-webhook.payload.js';

/**
 * Eventos `repository` sobre el binding de CUALQUIER Project, incluidos los personales
 * (`INTEROP-2.4` §6.9, "Eventos de acceso"); se procesan aunque el binding no esté `ENABLED`:
 *
 * - `renamed`: actualiza `repositoryName` (el estado no cambia);
 * - `transferred`: si el nuevo propietario no es la cuenta/organización del Project, binding
 *   `REVOKED` y borrado de los registros Maintainer/Reader; si lo es, solo actualiza el nombre;
 * - `deleted`: binding `REVOKED` y borrado de los registros Maintainer/Reader;
 * - `privatized`: reverifica todos los registros de los Projects vinculados; eso es la
 *   reverificación de la etapa 3b (`ACCESS_REVERIFY`), así que hasta entonces no hace nada
 *   (los registros los corrige la reconciliación cuando exista).
 *
 * El binding se selecciona SOLO por `repository.id`. Todo es idempotente (un evento duplicado
 * o tardío repite el mismo efecto; una revocación nunca se deshace por un evento). Un renombre
 * fuera de orden puede dejar el nombre anterior hasta la reconciliación (c), que lee el nombre
 * vigente por id. Los demás `action` (`archived`, `publicized`, `edited`...) se ignoran.
 */
@Injectable()
export class RepositoryEventsService {
  private readonly logger = new Logger(RepositoryEventsService.name);

  constructor(
    private readonly bindings: RepositoryBindingsRepository,
    private readonly lifecycle: BindingLifecycleService,
  ) {}

  async handle(payload: GithubRepositoryWebhookPayload): Promise<void> {
    if (!HANDLED_ACTIONS.has(payload.action) || typeof payload.repository?.id !== 'number') {
      return;
    }

    const binding = await this.bindings.findByRepositoryIdWithWorkspace(String(payload.repository.id));

    if (!binding) {
      return;
    }

    switch (payload.action) {
      case 'renamed':
        await this.applyName(binding, payload);
        return;

      case 'deleted':
        await this.lifecycle.revokeBinding(binding);
        return;

      case 'transferred':
        await this.handleTransfer(binding, payload);
        return;

      default:
        // `privatized`: la reverificación de registros es de la etapa 3b.
        this.logger.debug(`repository.${payload.action} sobre el binding "${binding.id}": sin efecto hasta la etapa 3b.`);
    }
  }

  private async handleTransfer(binding: BindingWithWorkspace, payload: GithubRepositoryWebhookPayload): Promise<void> {
    const newOwnerId = payload.repository.owner?.id;

    if (newOwnerId === undefined) {
      this.logger.warn(`repository.transferred sin propietario para el binding "${binding.id}": lo corrige la reconciliación.`);
      return;
    }

    const expectedOwnerId = await this.lifecycle.expectedOwnerId(binding.project);

    // Sin propietario esperado (Project personal sin identidad persistida) no se infiere una transferencia.
    if (expectedOwnerId !== null && String(newOwnerId) !== expectedOwnerId) {
      await this.lifecycle.revokeBinding(binding);
      return;
    }

    await this.applyName(binding, payload);
  }

  private async applyName(binding: BindingWithWorkspace, payload: GithubRepositoryWebhookPayload): Promise<void> {
    const fullName = payload.repository.full_name;

    if (typeof fullName !== 'string' || !fullName.includes('/') || fullName === binding.repositoryName) {
      return;
    }

    await this.bindings.updateRepositoryName(binding.id, fullName);
  }
}

const HANDLED_ACTIONS: ReadonlySet<string> = new Set(['renamed', 'transferred', 'deleted', 'privatized']);
