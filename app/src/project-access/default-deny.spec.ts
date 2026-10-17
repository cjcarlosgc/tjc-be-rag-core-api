import { Controller, Get, Module, Post, type INestApplication } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../common/errors/app.exception.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { Public } from '../common/auth/public.decorator.js';
import { NoProjectRole, ProjectTargets, RequireProjectRole } from './access-policy.js';
import { ProjectAccessService } from './project-access.service.js';
import { ProjectRoleGuard } from './project-role.guard.js';
import { listRouteAccess, RouteAccessAuditor } from './route-access-audit.js';

const handled = vi.fn();
const requireForResource = vi.fn();

@Controller('demo')
class DeclaredController {
  @Get(':id')
  @RequireProjectRole('MAINTAINER', ProjectTargets.project('id'))
  guarded(): string {
    handled('guarded');
    return 'ok';
  }

  @Post()
  @NoProjectRole('sin recurso')
  free(): string {
    handled('free');
    return 'ok';
  }

  @Public()
  @Get('open/health')
  open(): string {
    return 'ok';
  }
}

@Controller('forgotten')
class UndeclaredController {
  @Get()
  forgotten(): string {
    handled('forgotten');
    return 'reached';
  }
}

async function buildApp(controllers: Array<new () => object>, withAuditor: boolean): Promise<INestApplication> {
  @Module({
    imports: [DiscoveryModule],
    controllers,
    providers: [
      { provide: ProjectAccessService, useValue: { requireForResource } },
      ...(withAuditor ? [RouteAccessAuditor] : []),
      { provide: APP_GUARD, useClass: ProjectRoleGuard },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  // Sustituye a AuthGuard: fija la identidad.
  app.use((req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'u1';
    next();
  });
  return app;
}

describe('default-deny of routes without an access declaration', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    handled.mockReset();
    requireForResource.mockReset().mockResolvedValue({ project: {}, role: 'ADMIN' });
  });

  it('the guard rejects a route with no declaration and never runs its handler', async () => {
    app = await buildApp([UndeclaredController], false);
    await app.init();

    const response = await request(app.getHttpServer()).get('/forgotten').expect(500);

    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(handled).not.toHaveBeenCalled();
  });

  it('the application refuses to start when a route is undeclared', async () => {
    app = await buildApp([DeclaredController, UndeclaredController], true);

    await expect(app.init()).rejects.toThrow(/GET \/forgotten \(UndeclaredController\.forgotten\)/);
  });

  it('starts when every route declares a role, an exception or is public, and enforces the role through the access service', async () => {
    requireForResource.mockResolvedValue({ project: {}, role: 'MAINTAINER' });
    app = await buildApp([DeclaredController], true);
    await app.init();

    await request(app.getHttpServer()).get('/demo/p1').expect(200);
    expect(requireForResource).toHaveBeenCalledWith('u1', 'project', 'p1', 'MAINTAINER');

    requireForResource.mockRejectedValue(new AppException('PROJECT_ROLE_INSUFFICIENT' as never, 'no', 403, { requiredRole: 'MAINTAINER', currentRole: 'READER' }));
    const denied = await request(app.getHttpServer()).get('/demo/p1').expect(403);
    expect(denied.body).toMatchObject({ code: 'PROJECT_ROLE_INSUFFICIENT', details: { requiredRole: 'MAINTAINER', currentRole: 'READER' } });
    await request(app.getHttpServer()).post('/demo').expect(201);
    await request(app.getHttpServer()).get('/demo/open/health').expect(200);
  });

  it('enumerates every route with its method, full path and declared policy', async () => {
    app = await buildApp([DeclaredController, UndeclaredController], false);
    await app.init();

    const routes = listRouteAccess(app.get(DiscoveryService), app.get(MetadataScanner));

    expect(routes.map((route) => [route.method, route.path, route.policy === null ? 'UNDECLARED' : route.policy === 'PUBLIC' ? 'PUBLIC' : route.policy.kind]).sort()).toEqual(
      [
        ['GET', '/demo/:id', 'ROLE'],
        ['POST', '/demo', 'NONE'],
        ['GET', '/demo/open/health', 'PUBLIC'],
        ['GET', '/forgotten', 'UNDECLARED'],
      ].sort(),
    );
  });
});
