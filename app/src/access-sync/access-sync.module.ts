import { Module } from '@nestjs/common';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { RepositoryBindingsModule } from '../repository-bindings/repository-bindings.module.js';
import { AccessReconciliationJobHandler } from './access-reconciliation.job-handler.js';
import { AccessReverifyJobHandler } from './access-reverify.job-handler.js';
import { AccessReverifyService } from './access-reverify.service.js';
import { BindingLifecycleService } from './binding-lifecycle.service.js';
import { OrganizationLifecycleService } from './organization-lifecycle.service.js';

/**
 * HU61: sincronización del binding y de los accesos con GitHub (transiciones a `REVOKED`,
 * renombre, reverificación de registros por evento y la reconciliación horaria). `JobsModule`, `RealtimeModule` (expulsión de
 * sockets) y `AuthModule` (identidad persistida) son globales.
 */
@Module({
  imports: [RepositoryBindingsModule, ProjectAccessModule, GithubAppModule],
  providers: [
    BindingLifecycleService,
    OrganizationLifecycleService,
    AccessReverifyService,
    AccessReverifyJobHandler,
    AccessReconciliationJobHandler,
  ],
  exports: [BindingLifecycleService, OrganizationLifecycleService, AccessReverifyService],
})
export class AccessSyncModule {}
