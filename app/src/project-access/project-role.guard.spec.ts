import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../common/auth/auth.constants.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ACCESS_POLICY_KEY, NoProjectRole, ProjectTargets, RequireProjectRole, type AccessPolicy } from './access-policy.js';
import { ProjectRoleGuard } from './project-role.guard.js';
import { FunctionalKnowledgeController } from '../functional-knowledge/functional-knowledge.controller.js';
import { TestPublicationsController } from '../publications/test-publications.controller.js';
import { ExperimentsController } from '../experiments/experiments.controller.js';
import { RepositoryBindingsController } from '../repository-bindings/repository-bindings.controller.js';

function contextOf(
  policy: AccessPolicy | undefined,
  request: Record<string, unknown> = {},
  options: { type?: 'http' | 'ws'; isPublic?: boolean } = {},
): ExecutionContext {
  class Controller {}
  const handler = function handle() {};
  if (policy) {
    Reflect.defineMetadata(ACCESS_POLICY_KEY, policy, handler);
  }
  if (options.isPublic) {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    getType: () => options.type ?? 'http',
    switchToHttp: () => ({ getRequest: () => ({ params: {}, query: {}, body: {}, ...request }) }),
  } as unknown as ExecutionContext;
}

function makeGuard() {
  const projectAccess = { requireForResource: vi.fn().mockResolvedValue({ project: {}, role: 'ADMIN' }) };
  return { guard: new ProjectRoleGuard(new Reflector(), projectAccess as never), projectAccess };
}

const role = (minRole: 'READER' | 'WRITER' | 'MAINTAINER' | 'ADMIN', target: ReturnType<typeof ProjectTargets.project>): AccessPolicy => ({
  kind: 'ROLE',
  minRole,
  target,
});

describe('ProjectRoleGuard (default-deny, INTEROP-2.4 §6.13)', () => {
  it('lets a @Public() route through without evaluating anything', async () => {
    const { guard, projectAccess } = makeGuard();

    await expect(guard.canActivate(contextOf(undefined, {}, { isPublic: true }))).resolves.toBe(true);
    expect(projectAccess.requireForResource).not.toHaveBeenCalled();
  });

  it('DENIES an HTTP route that declares neither a role nor an explicit exception (500, never allowed)', async () => {
    const { guard, projectAccess } = makeGuard();

    await expect(guard.canActivate(contextOf(undefined, { userId: 'u1' }))).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
    expect(projectAccess.requireForResource).not.toHaveBeenCalled();
  });

  it('DENIES a WebSocket handler that declares nothing', async () => {
    const { guard } = makeGuard();

    await expect(guard.canActivate(contextOf(undefined, {}, { type: 'ws' }))).rejects.toMatchObject({
      error: { code: ErrorCode.INTERNAL_ERROR },
    });
  });

  it('allows an explicit exception (@NoProjectRole) without a Project role check', async () => {
    const { guard, projectAccess } = makeGuard();
    const decorated = { kind: 'NONE', reason: 'sin recurso' } as const;

    await expect(guard.canActivate(contextOf(decorated, { userId: 'u1' }))).resolves.toBe(true);
    expect(projectAccess.requireForResource).not.toHaveBeenCalled();
  });

  it('requires the Project role for a project id taken from a route param', async () => {
    const { guard, projectAccess } = makeGuard();

    await guard.canActivate(contextOf(role('MAINTAINER', ProjectTargets.project('projectId')), { userId: 'u1', params: { projectId: 'p1' } }));

    expect(projectAccess.requireForResource).toHaveBeenCalledWith('u1', 'project', 'p1', 'MAINTAINER');
  });

  it('resolves a descendant resource (deep link) from its param, query or body', async () => {
    const { guard, projectAccess } = makeGuard();

    await guard.canActivate(
      contextOf(role('READER', ProjectTargets.param('analysisRun', 'analysisRunId')), { userId: 'u1', params: { analysisRunId: 'run-1' } }),
    );
    await guard.canActivate(
      contextOf(role('MAINTAINER', ProjectTargets.body('project', 'projectId')), { userId: 'u1', body: { projectId: 'p2' } }),
    );
    await guard.canActivate(
      contextOf(role('READER', ProjectTargets.optionalQueryProject('projectId')), { userId: 'u1', query: { projectId: 'p3' } }),
    );

    expect(projectAccess.requireForResource.mock.calls).toEqual([
      ['u1', 'analysisRun', 'run-1', 'READER'],
      ['u1', 'project', 'p2', 'MAINTAINER'],
      ['u1', 'project', 'p3', 'READER'],
    ]);
  });

  it('delegates a WRITER minimum to the access service with the role name unchanged (WI-CORE-019)', async () => {
    const { guard, projectAccess } = makeGuard();

    await guard.canActivate(contextOf(role('WRITER', ProjectTargets.project('projectId')), { userId: 'u1', params: { projectId: 'p1' } }));

    expect(projectAccess.requireForResource).toHaveBeenCalledWith('u1', 'project', 'p1', 'WRITER');
  });

  it('a listing route and an absent optional/body id do not resolve a resource (the DTO and the predicate decide)', async () => {
    const { guard, projectAccess } = makeGuard();

    await expect(guard.canActivate(contextOf(role('READER', ProjectTargets.listing()), { userId: 'u1' }))).resolves.toBe(true);
    await expect(
      guard.canActivate(contextOf(role('READER', ProjectTargets.optionalQueryProject('projectId')), { userId: 'u1' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextOf(role('MAINTAINER', ProjectTargets.body('project', 'projectId')), { userId: 'u1', body: { projectId: 42 } })),
    ).resolves.toBe(true);
    expect(projectAccess.requireForResource).not.toHaveBeenCalled();
  });

  it('propagates 404 / 403 PROJECT_ROLE_INSUFFICIENT / 503 from the access service', async () => {
    const { guard, projectAccess } = makeGuard();
    const context = () =>
      contextOf(role('ADMIN', ProjectTargets.project('id')), { userId: 'u1', params: { id: 'p1' } });

    for (const code of [ErrorCode.PROJECT_NOT_FOUND, ErrorCode.PROJECT_ROLE_INSUFFICIENT, ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE]) {
      projectAccess.requireForResource.mockRejectedValueOnce(new AppException(code, 'x', 403));
      await expect(guard.canActivate(context())).rejects.toMatchObject({ code });
    }
  });

  it('fails closed with 401 when the identity guard did not run (no userId)', async () => {
    const { guard, projectAccess } = makeGuard();

    await expect(
      guard.canActivate(contextOf(role('READER', ProjectTargets.project('id')), { params: { id: 'p1' } })),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_REQUIRED });
    expect(projectAccess.requireForResource).not.toHaveBeenCalled();
  });

  it('leaves the WebSocket subscribe check to the gateway (which acks instead of throwing) but still requires the declaration', async () => {
    const { guard, projectAccess } = makeGuard();

    await expect(
      guard.canActivate(contextOf(role('READER', ProjectTargets.body('projectVersion', 'projectVersionId')), {}, { type: 'ws' })),
    ).resolves.toBe(true);
    expect(projectAccess.requireForResource).not.toHaveBeenCalled();
  });

  it('the decorators store the declared policy; @NoProjectRole demands a reason', () => {
    class Demo {
      @RequireProjectRole('MAINTAINER', ProjectTargets.project('id'))
      guarded(): void {}

      @NoProjectRole('sesión GitHub válida basta')
      free(): void {}
    }

    expect(Reflect.getMetadata(ACCESS_POLICY_KEY, Demo.prototype.guarded)).toEqual({
      kind: 'ROLE',
      minRole: 'MAINTAINER',
      target: { from: 'param', name: 'id', resource: 'project' },
    });
    expect(Reflect.getMetadata(ACCESS_POLICY_KEY, Demo.prototype.free)).toEqual({ kind: 'NONE', reason: 'sesión GitHub válida basta' });
    expect(() => NoProjectRole('  ')).toThrow();
  });

  // INTEROP-2.7 §6.13 (WI-CORE-019, corte B): las operaciones que pasan a Writer declaran Writer en
  // el controlador; responder preguntas y UNKNOWN siguen en Maintainer.
  it('declares Writer on the binding, publication and experiment operations and keeps Maintainer for answering questions', () => {
    const minRoleOf = (target: object, method: string): string => {
      const handler = (target as Record<string, unknown>)[method] as object;
      return (Reflect.getMetadata(ACCESS_POLICY_KEY, handler) as { minRole: string }).minRole;
    };

    expect(minRoleOf(RepositoryBindingsController.prototype, 'create')).toBe('WRITER');
    expect(minRoleOf(RepositoryBindingsController.prototype, 'enable')).toBe('WRITER');
    expect(minRoleOf(RepositoryBindingsController.prototype, 'remove')).toBe('WRITER');
    expect(minRoleOf(RepositoryBindingsController.prototype, 'get')).toBe('READER');
    expect(minRoleOf(TestPublicationsController.prototype, 'create')).toBe('WRITER');
    expect(minRoleOf(ExperimentsController.prototype, 'create')).toBe('WRITER');
    expect(minRoleOf(FunctionalKnowledgeController.prototype, 'submitAnswer')).toBe('MAINTAINER');
  });
});
