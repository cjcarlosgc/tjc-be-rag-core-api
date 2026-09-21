import { describe, expect, it, vi } from 'vitest';
import { accessibleProject } from './accessible-project.filter.js';
import { ProjectsRepository } from '../../projects/projects.repository.js';
import { ProjectVersionsRepository } from '../../project-versions/project-versions.repository.js';
import { TestTargetsRepository } from '../../project-versions/persistence/test-targets.repository.js';
import { FunctionalQuestionsRepository } from '../../functional-knowledge/functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from '../../functional-knowledge/functional-knowledge.repository.js';
import { TestPublicationsRepository } from '../../publications/test-publications.repository.js';
import { ExperimentRunsRepository } from '../../experiments/persistence/experiment-runs.repository.js';
import { AnalysisRunsRepository } from '../../analysis-runs/analysis-runs.repository.js';
import { RepositoryBindingsRepository } from '../../repository-bindings/repository-bindings.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * HU56/HU59: toda lectura user-scoped pasa por el predicado `accessibleProject`, de modo
 * que un Project borrado lógicamente o no visible se comporta como inexistente. Cada caso
 * ejecuta una lectura real del repositorio contra un Prisma espía y exige, en el filtro
 * del Project, `deletedAt: null` y las tres ramas del predicado (personal por creador,
 * Admin de organización, registro suficiente con binding no `REVOKED`).
 */
describe('user-scoped reads use the accessibleProject predicate (HU56, HU59)', () => {
  it('accessibleProject has the personal, organization-Admin and organization-record branches', () => {
    expect(accessibleProject('u1')).toEqual({
      deletedAt: null,
      OR: [
        { githubOrgId: null, ownerUserId: 'u1' },
        { githubOrgId: { not: null }, access: { some: { userId: 'u1', role: 'ADMIN' } } },
        {
          githubOrgId: { not: null },
          access: { some: { userId: 'u1', role: { in: ['READER', 'MAINTAINER', 'ADMIN'] } } },
          NOT: { repositoryBinding: { is: { status: 'REVOKED' } } },
        },
      ],
    });
  });

  it('the minimum role narrows the record branch only', () => {
    expect(accessibleProject('u1', 'MAINTAINER').OR?.[2]).toMatchObject({
      access: { some: { userId: 'u1', role: { in: ['MAINTAINER', 'ADMIN'] } } },
    });
  });

  const model = () => ({
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  });

  function scenario<T>(
    name: string,
    delegate: string,
    build: (prisma: PrismaService) => T,
    run: (repo: T) => Promise<unknown>,
  ) {
    it(`${name} applies the accessibleProject predicate`, async () => {
      const prisma = { [delegate]: model() };
      await run(build(prisma as unknown as PrismaService));

      const call = prisma[delegate].findFirst.mock.calls[0] ?? prisma[delegate].findMany.mock.calls[0];
      const where = JSON.stringify(call[0].where);
      expect(where).toContain('"deletedAt":null');
      expect(where).toContain(JSON.stringify(accessibleProject('u1').OR));
    });
  }
  scenario('AnalysisRunsRepository.findVisibleForUser', 'analysisRun', (p) => new AnalysisRunsRepository(p), (r) =>
    r.findVisibleForUser('u1', 10, undefined, undefined));
  scenario('ProjectsRepository.findById', 'project', (p) => new ProjectsRepository(p), (r) => r.findById('p1', 'u1'));
  scenario('ProjectsRepository.findAll', 'project', (p) => new ProjectsRepository(p), (r) => r.findAll(10, 'u1'));
  scenario('ProjectVersionsRepository.findByIdForOwner', 'projectVersion', (p) => new ProjectVersionsRepository(p), (r) =>
    r.findByIdForOwner('v1', 'u1'));
  scenario('TestTargetsRepository.findByIdForOwner', 'testTarget', (p) => new TestTargetsRepository(p), (r) =>
    r.findByIdForOwner('t1', 'u1'));
  scenario('FunctionalQuestionsRepository.findActionRequired', 'functionalQuestion', (p) => new FunctionalQuestionsRepository(p), (r) =>
    r.findActionRequired('u1', undefined, 'PENDING', 10, undefined));
  scenario('FunctionalKnowledgeRepository.findByProjectForOwner', 'functionalKnowledge', (p) => new FunctionalKnowledgeRepository(p), (r) =>
    r.findByProjectForOwner('p1', 'u1', undefined, 10, undefined));
  scenario('TestPublicationsRepository.findByIdForOwner', 'testPublication', (p) => new TestPublicationsRepository(p), (r) =>
    r.findByIdForOwner('tp1', 'u1'));
  scenario('ExperimentRunsRepository.findByIdForOwner', 'experimentRun', (p) => new ExperimentRunsRepository(p), (r) =>
    r.findByIdForOwner('e1', 'u1'));
  scenario('AnalysisRunsRepository.findByIdForOwner', 'analysisRun', (p) => new AnalysisRunsRepository(p), (r) =>
    r.findByIdForOwner('r1', 'u1'));
  scenario('AnalysisRunsRepository.findByProjectForOwner', 'analysisRun', (p) => new AnalysisRunsRepository(p), (r) =>
    r.findByProjectForOwner('p1', 'u1', 10, undefined, undefined));
  scenario('RepositoryBindingsRepository.findByProjectForOwner', 'repositoryBinding', (p) => new RepositoryBindingsRepository(p), (r) =>
    r.findByProjectForOwner('p1', 'u1'));
});
