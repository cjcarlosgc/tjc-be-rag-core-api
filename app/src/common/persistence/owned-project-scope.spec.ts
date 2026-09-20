import { describe, expect, it, vi } from 'vitest';
import { ownedProject } from './owned-project.filter.js';
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
 * HU56: un Project borrado lógicamente se comporta como inexistente en toda
 * lectura owner-scoped. Cada caso ejecuta una lectura real del repositorio
 * contra un Prisma espía y exige `deletedAt: null` en el filtro del Project.
 */
describe('owner-scoped reads hide logically deleted projects (HU56)', () => {
  it('ownedProject scopes by owner and excludes deleted projects', () => {
    expect(ownedProject('u1')).toEqual({ ownerUserId: 'u1', deletedAt: null });
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
    it(`${name} filters deletedAt: null`, async () => {
      const prisma = { [delegate]: model() };
      await run(build(prisma as unknown as PrismaService));

      const call = prisma[delegate].findFirst.mock.calls[0] ?? prisma[delegate].findMany.mock.calls[0];
      expect(JSON.stringify(call[0].where)).toContain('"deletedAt":null');
    });
  }
  scenario('ProjectsRepository.findById', 'project', (p) => new ProjectsRepository(p), (r) => r.findById('p1', 'u1'));
  scenario('ProjectsRepository.findAll', 'project', (p) => new ProjectsRepository(p), (r) => r.findAll(10, 'u1'));
  scenario('ProjectVersionsRepository.findByIdForOwner', 'projectVersion', (p) => new ProjectVersionsRepository(p), (r) =>
    r.findByIdForOwner('v1', 'u1'));
  scenario('TestTargetsRepository.findByIdForOwner', 'testTarget', (p) => new TestTargetsRepository(p), (r) =>
    r.findByIdForOwner('t1', 'u1'));
  scenario('FunctionalQuestionsRepository.findActionRequired', 'functionalQuestion', (p) => new FunctionalQuestionsRepository(p), (r) =>
    r.findActionRequired('u1', undefined, 'OPEN', 10, undefined));
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
