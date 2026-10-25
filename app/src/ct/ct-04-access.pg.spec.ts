import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { FunctionalKnowledgeRepository } from '../functional-knowledge/functional-knowledge.repository.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * CT-04-A5: con Postgres real, un usuario sin acceso al Project no lee las reglas funcionales
 * (`FunctionalKnowledgeRepository.findByProjectForOwner` con `accessibleProject`) ni resuelve el Project
 * (`ProjectsRepository.findById`); un Project borrado lógicamente se comporta como inexistente. La confirmación
 * sin rol suficiente ya está cubierta por CT-04-A3.
 *
 * Necesita un PostgreSQL LOCAL descartable con las migraciones aplicadas: sin `CT_TEST_DATABASE_URL` se omite.
 * La URL debe apuntar a localhost. Crea sus propias filas con ids únicos y borra solo esas (no vacía tablas).
 *
 *   CT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/rag_core_ct?schema=public \
 *     pnpm exec vitest run src/ct/ct-04-access.pg.spec.ts
 */
const url = process.env.CT_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

describe.skipIf(!url)('CT-04 acceso a Functional Knowledge contra un PostgreSQL local', () => {
  let prisma: PrismaClient;
  let knowledge: FunctionalKnowledgeRepository;
  let projects: ProjectsRepository;

  const suffix = randomUUID();
  const adminUserId = `ct04-admin-${suffix}`;
  const readerUserId = `ct04-reader-${suffix}`;
  const outsiderUserId = `ct04-outsider-${suffix}`;
  const projectId = randomUUID();
  const deletedProjectId = randomUUID();
  const bindingId = randomUUID();
  const ruleId = randomUUID();
  const deletedRuleId = randomUUID();
  const createdProjectIds = [projectId, deletedProjectId];

  const ruleData = (id: string, forProjectId: string) => ({
    id,
    projectId: forProjectId,
    scope: 'METHOD' as const,
    targetRef: 'src/thing.ts::Thing.doIt',
    originalQuestion: '¿Qué hace?',
    originalAnswer: 'sí',
    normalizedRule: 'Devuelve true cuando el valor es válido.',
    scenarioKind: 'EXPECTED_RESULT' as const,
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
  });

  beforeAll(async () => {
    if (!isLocal) {
      throw new Error('CT_TEST_DATABASE_URL debe apuntar a localhost.');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    knowledge = new FunctionalKnowledgeRepository(prisma as unknown as PrismaService);
    projects = new ProjectsRepository(prisma as unknown as PrismaService);

    // Dos Projects de organización (githubOrgId y githubOrgLogin van juntos por un check de la migración).
    for (const id of createdProjectIds) {
      await prisma.project.create({
        data: { id, name: `ct04-${id}`, ownerUserId: adminUserId, githubOrgId: `ct04-org-${suffix}`, githubOrgLogin: `ct04-org-${suffix}` },
      });
      await prisma.projectAccess.create({
        data: { projectId: id, userId: adminUserId, role: 'ADMIN', verifiedAt: new Date() },
      });
    }
    // Un lector con registro en el Project vivo: su visibilidad exige además un binding no REVOKED.
    await prisma.projectAccess.create({
      data: { projectId, userId: readerUserId, role: 'READER', verifiedAt: new Date() },
    });
    await prisma.repositoryBinding.create({
      data: {
        id: bindingId,
        projectId,
        installationId: `ct04-installation-${suffix}`,
        repositoryId: `ct04-repository-${suffix}`,
        repositoryName: 'org/ct04',
        integrationBranch: 'develop',
        status: 'ENABLED',
      },
    });
    await prisma.functionalKnowledge.create({ data: ruleData(ruleId, projectId) });
    await prisma.functionalKnowledge.create({ data: ruleData(deletedRuleId, deletedProjectId) });
  });

  afterAll(async () => {
    if (prisma) {
      // Solo las filas creadas aquí, en orden de claves foráneas.
      await prisma.functionalKnowledge.deleteMany({ where: { projectId: { in: createdProjectIds } } });
      await prisma.repositoryBinding.deleteMany({ where: { projectId: { in: createdProjectIds } } });
      await prisma.projectAccess.deleteMany({ where: { projectId: { in: createdProjectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
      await prisma.$disconnect();
    }
  });

  const rulesFor = (forProjectId: string, userId: string) =>
    knowledge.findByProjectForOwner(forProjectId, userId, undefined, 10, undefined);

  it('CT-04-A5: un usuario con acceso al Project (Admin y Reader con binding) lee la regla ACTIVE y resuelve el Project', async () => {
    for (const userId of [adminUserId, readerUserId]) {
      const rules = await rulesFor(projectId, userId);
      expect(rules.map((rule) => rule.id)).toEqual([ruleId]);
      await expect(projects.findById(projectId, userId)).resolves.toMatchObject({ id: projectId });
    }
  });

  it('CT-04-A5: un usuario sin acceso al Project no lee sus reglas funcionales ni resuelve el Project', async () => {
    await expect(rulesFor(projectId, outsiderUserId)).resolves.toEqual([]);
    await expect(projects.findById(projectId, outsiderUserId)).resolves.toBeNull();
  });

  it('CT-04-A5: el filtro de acceso se evalúa por consulta: con el binding REVOKED el Reader pierde acceso y el Admin lo conserva', async () => {
    await prisma.repositoryBinding.update({ where: { id: bindingId }, data: { status: 'REVOKED' } });
    try {
      await expect(rulesFor(projectId, readerUserId)).resolves.toEqual([]);
      await expect(projects.findById(projectId, readerUserId)).resolves.toBeNull();
      await expect(rulesFor(projectId, adminUserId)).resolves.toHaveLength(1);
    } finally {
      await prisma.repositoryBinding.update({ where: { id: bindingId }, data: { status: 'ENABLED' } });
    }
  });

  it('CT-04-A5: un Project borrado lógicamente se comporta como inexistente, también para su Admin', async () => {
    await expect(rulesFor(deletedProjectId, adminUserId)).resolves.toHaveLength(1);

    await expect(projects.softDelete(deletedProjectId, adminUserId)).resolves.toBe(true);

    await expect(projects.findById(deletedProjectId, adminUserId)).resolves.toBeNull();
    await expect(rulesFor(deletedProjectId, adminUserId)).resolves.toEqual([]);
    // La regla se conserva como evidencia: solo el acceso por usuario deja de verla.
    await expect(prisma.functionalKnowledge.count({ where: { id: deletedRuleId } })).resolves.toBe(1);
  });
});
