import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { GithubAppModule } from '../github-app/github-app.module.js';
import { OrganizationAccessResolver } from './organization-access.resolver.js';
import { ProjectAccessRepository } from './project-access.repository.js';
import { ProjectAccessService } from './project-access.service.js';
import { ProjectRoleGuard } from './project-role.guard.js';
import { RouteAccessAuditor } from './route-access-audit.js';

/**
 * Además del servicio de acceso registra el guard global default-deny (`ProjectRoleGuard`) y
 * la comprobación de arranque (`RouteAccessAuditor`). `AppModule` importa este módulo justo
 * después de `AuthModule`, de modo que `AuthGuard` (identidad) corre primero; el guard igualmente
 * falla cerrado si no hay identidad.
 */
@Module({
  imports: [GithubAppModule, DiscoveryModule],
  providers: [
    ProjectAccessRepository,
    OrganizationAccessResolver,
    ProjectAccessService,
    RouteAccessAuditor,
    { provide: APP_GUARD, useClass: ProjectRoleGuard },
  ],
  exports: [ProjectAccessRepository, OrganizationAccessResolver, ProjectAccessService],
})
export class ProjectAccessModule {}
