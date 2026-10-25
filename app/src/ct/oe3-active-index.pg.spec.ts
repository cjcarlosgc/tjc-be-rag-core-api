import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  ActiveKnowledgeConflictError,
  FunctionalKnowledgeRepository,
  type CreateFunctionalKnowledgeInput,
} from '../functional-knowledge/functional-knowledge.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * OE3-C5/C6 (WI-CORE-100): con Postgres real y el `FunctionalKnowledgeRepository` real, el índice único
 * parcial `functional_knowledge_active_scenario_key`
 * (`(projectId, scope, COALESCE(targetRef,''), scenarioKey) WHERE status = 'ACTIVE'`, solo existe en la
 * migración SQL) garantiza una sola regla ACTIVE por clave; el repositorio traduce la violación (P2002) a
 * `ActiveKnowledgeConflictError` con la ganadora, `supersede` es atómico y la regla guarda su auditoría.
 *
 * Necesita un PostgreSQL LOCAL descartable con las migraciones aplicadas: sin `CT_TEST_DATABASE_URL` se omite.
 * La URL debe apuntar a localhost. Crea sus propias filas con ids únicos y borra solo esas (no vacía tablas).
 *
 *   CT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/rag_core_ct?schema=public \
 *     pnpm exec vitest run src/ct/oe3-active-index.pg.spec.ts
 */
const url = process.env.CT_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

describe.skipIf(!url)('OE3-C5/C6: índice único parcial de reglas ACTIVE contra un PostgreSQL local', () => {
  let prisma: PrismaClient;
  let repository: FunctionalKnowledgeRepository;

  const suffix = randomUUID();
  const projectId = randomUUID();
  const userId = `oe3-user-${suffix}`;

  const keyOf = (name: string) => `EXPECTED_RESULT:${name}-${suffix}`;

  const input = (overrides: Partial<CreateFunctionalKnowledgeInput> = {}): CreateFunctionalKnowledgeInput => ({
    projectId,
    scope: 'METHOD',
    targetRef: 'src/thing.ts::Thing.doIt',
    originalQuestion: '¿Qué hace?',
    originalAnswer: 'Devuelve true cuando el valor es válido.',
    normalizedRule: 'Devuelve true cuando el valor es válido.',
    scenarioKind: 'EXPECTED_RESULT',
    scenarioKey: keyOf('default'),
    ...overrides,
  });

  const activeRules = (where: { scope?: 'METHOD' | 'PROJECT'; targetRef?: string | null; scenarioKey: string }) =>
    prisma.functionalKnowledge.findMany({ where: { projectId, status: 'ACTIVE', ...where } });

  beforeAll(async () => {
    if (!isLocal) {
      throw new Error('CT_TEST_DATABASE_URL debe apuntar a localhost.');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    repository = new FunctionalKnowledgeRepository(prisma as unknown as PrismaService);

    await prisma.project.create({ data: { id: projectId, name: `oe3-${projectId}`, ownerUserId: userId } });
  });

  afterAll(async () => {
    if (prisma) {
      // Solo las filas creadas aquí, en orden de claves foráneas.
      await prisma.functionalKnowledge.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.$disconnect();
    }
  });

  it('OE3-C6: el índice rechaza una segunda regla ACTIVE de la misma clave y el repositorio devuelve el conflicto con la ganadora', async () => {
    const scenarioKey = keyOf('conflict');
    const first = await repository.create(input({ scenarioKey, normalizedRule: 'regla ganadora' }));

    const attempt = repository.create(input({ scenarioKey, normalizedRule: 'regla perdedora' }));
    await expect(attempt).rejects.toBeInstanceOf(ActiveKnowledgeConflictError);
    await expect(attempt).rejects.toMatchObject({ winner: { id: first.id, normalizedRule: 'regla ganadora' } });

    const rules = await activeRules({ scenarioKey });
    expect(rules.map((rule) => rule.id)).toEqual([first.id]);
    expect(rules[0].normalizedRule).toBe('regla ganadora');
  });

  it('OE3-C6: el índice trata targetRef nulo (alcance PROJECT) como clave propia y rechaza una segunda ACTIVE', async () => {
    const scenarioKey = keyOf('project-null');
    const first = await repository.create(input({ scope: 'PROJECT', targetRef: null, scenarioKey }));
    expect(first.targetRef).toBeNull();

    const attempt = repository.create(input({ scope: 'PROJECT', targetRef: null, scenarioKey, normalizedRule: 'otra' }));
    await expect(attempt).rejects.toBeInstanceOf(ActiveKnowledgeConflictError);
    await expect(attempt).rejects.toMatchObject({ winner: { id: first.id, targetRef: null } });

    // El COALESCE(targetRef, '') es parte de la clave: un targetRef no vacío del mismo scope coexiste con el nulo.
    const withTarget = await repository.create(input({ scope: 'PROJECT', targetRef: 'src/x.ts', scenarioKey }));
    expect(withTarget.status).toBe('ACTIVE');
    expect(await activeRules({ scope: 'PROJECT', targetRef: null, scenarioKey })).toHaveLength(1);
  });

  it('OE3-C5: una regla SUPERSEDED no cuenta para el índice: se puede crear otra ACTIVE de la misma clave', async () => {
    const scenarioKey = keyOf('superseded');
    const old = await repository.create(input({ scenarioKey }));
    await prisma.functionalKnowledge.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } });

    const fresh = await repository.create(input({ scenarioKey, normalizedRule: 'nueva vigente' }));
    expect(fresh.status).toBe('ACTIVE');
    expect(fresh.id).not.toBe(old.id);

    const found = await repository.findActive(projectId, 'METHOD', 'src/thing.ts::Thing.doIt', scenarioKey);
    expect(found?.id).toBe(fresh.id);
    expect(await activeRules({ scenarioKey })).toHaveLength(1);
    expect(await prisma.functionalKnowledge.count({ where: { projectId, scenarioKey } })).toBe(2);
  });

  it('OE3-C5: claves de escenario distintas y targetRef distintos coexisten ACTIVE; findActive resuelve cada una', async () => {
    const targetA = 'src/a.ts::A.run';
    const targetB = 'src/b.ts::B.run';
    const a1 = await repository.create(input({ targetRef: targetA, scenarioKey: keyOf('coexist-1') }));
    const a2 = await repository.create(input({ targetRef: targetA, scenarioKey: keyOf('coexist-2'), scenarioKind: 'BOUNDARY' }));
    const b1 = await repository.create(input({ targetRef: targetB, scenarioKey: keyOf('coexist-1') }));

    expect([a1, a2, b1].every((rule) => rule.status === 'ACTIVE')).toBe(true);
    expect((await repository.findActive(projectId, 'METHOD', targetA, keyOf('coexist-1')))?.id).toBe(a1.id);
    expect((await repository.findActive(projectId, 'METHOD', targetA, keyOf('coexist-2')))?.id).toBe(a2.id);
    expect((await repository.findActive(projectId, 'METHOD', targetB, keyOf('coexist-1')))?.id).toBe(b1.id);
    expect((await repository.findActiveByTargetRef(projectId, targetA)).map((rule) => rule.id).sort()).toEqual(
      [a1.id, a2.id].sort(),
    );
  });

  it('OE3-C5: el mismo target y la misma clave con otro alcance (scope) coexisten ACTIVE; findActive resuelve por scope', async () => {
    const target = 'src/scope.ts::Scoped.run';
    const scenarioKey = keyOf('scope-coexist');
    const method = await repository.create(input({ targetRef: target, scenarioKey, scope: 'METHOD' }));
    const symbol = await repository.create(input({ targetRef: target, scenarioKey, scope: 'SYMBOL' }));

    expect(method.status).toBe('ACTIVE');
    expect(symbol.status).toBe('ACTIVE');
    expect((await repository.findActive(projectId, 'METHOD', target, scenarioKey))?.id).toBe(method.id);
    expect((await repository.findActive(projectId, 'SYMBOL', target, scenarioKey))?.id).toBe(symbol.id);
    expect(await repository.findActive(projectId, 'CLASS', target, scenarioKey)).toBeNull();
  });

  it('OE3-C5: supersede es atómico: la antigua queda SUPERSEDED y la nueva ACTIVE con supersedesId a la antigua', async () => {
    const scenarioKey = keyOf('supersede-ok');
    const old = await repository.create(input({ scenarioKey, normalizedRule: 'versión 1' }));

    const next = await repository.supersede(old.id, input({ scenarioKey, normalizedRule: 'versión 2' }));

    expect(next.status).toBe('ACTIVE');
    expect(next.supersedesId).toBe(old.id);
    expect(next.normalizedRule).toBe('versión 2');
    expect((await repository.findById(old.id))?.status).toBe('SUPERSEDED');
    const rules = await activeRules({ scenarioKey });
    expect(rules.map((rule) => rule.id)).toEqual([next.id]);
  });

  it('OE3-C6: si la inserción de supersede viola el índice, la transacción revierte y la antigua sigue ACTIVE', async () => {
    const keyOld = keyOf('rollback-old');
    const keyTaken = keyOf('rollback-taken');
    const old = await repository.create(input({ scenarioKey: keyOld, normalizedRule: 'antigua' }));
    const taken = await repository.create(input({ scenarioKey: keyTaken, normalizedRule: 'ya vigente en la otra clave' }));

    // La nueva regla usa una clave que ya tiene ACTIVE: el INSERT viola el índice después del UPDATE de la antigua.
    const attempt = repository.supersede(old.id, input({ scenarioKey: keyTaken, normalizedRule: 'intento' }));
    await expect(attempt).rejects.toBeInstanceOf(ActiveKnowledgeConflictError);
    await expect(attempt).rejects.toMatchObject({ winner: { id: taken.id } });

    expect((await repository.findById(old.id))?.status).toBe('ACTIVE');
    expect((await repository.findById(taken.id))?.status).toBe('ACTIVE');
    expect(await prisma.functionalKnowledge.count({ where: { projectId, supersedesId: old.id } })).toBe(0);
    expect(await prisma.functionalKnowledge.count({ where: { projectId, scenarioKey: keyOld } })).toBe(1);
    expect((await activeRules({ scenarioKey: keyTaken })).map((rule) => rule.id)).toEqual([taken.id]);
  });

  it('OE3-C6: dos creaciones concurrentes de la misma clave dejan exactamente una ACTIVE y la perdedora recibe el conflicto', async () => {
    const scenarioKey = keyOf('concurrent');

    const results = await Promise.allSettled([
      repository.create(input({ scenarioKey, normalizedRule: 'concurrente A' })),
      repository.create(input({ scenarioKey, normalizedRule: 'concurrente B' })),
    ]);

    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.create>>> => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ActiveKnowledgeConflictError);
    expect((rejected[0].reason as ActiveKnowledgeConflictError).winner.id).toBe(fulfilled[0].value.id);

    const rules = await activeRules({ scenarioKey });
    expect(rules.map((rule) => rule.id)).toEqual([fulfilled[0].value.id]);
    expect(await prisma.functionalKnowledge.count({ where: { projectId, scenarioKey } })).toBe(1);
  });

  it('OE3-C5/C6: la regla guarda las columnas de auditoría tal como se pasaron (HUMAN_ANSWER sin sourceRef)', async () => {
    const scenarioKey = keyOf('audit-human');
    const created = await repository.create(
      input({
        scenarioKey,
        scenarioKind: 'EXCEPTION',
        confirmedByUserId: userId,
        confirmedRole: 'MAINTAINER',
        originHeadSha: 'a'.repeat(40),
        source: 'HUMAN_ANSWER',
      }),
    );

    const stored = await prisma.functionalKnowledge.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({
      projectId,
      scope: 'METHOD',
      targetRef: 'src/thing.ts::Thing.doIt',
      source: 'HUMAN_ANSWER',
      status: 'ACTIVE',
      scenarioKind: 'EXCEPTION',
      scenarioKey,
      confirmedByUserId: userId,
      confirmedRole: 'MAINTAINER',
      originHeadSha: 'a'.repeat(40),
      sourceRef: null,
      supersedesId: null,
    });
  });

  it('OE3-C5/C6: sourceRef solo se persiste con APPROVED_IMPORT; con HUMAN_ANSWER el repositorio lo rechaza sin escribir', async () => {
    const importKey = keyOf('audit-import');
    const imported = await repository.create(
      input({
        scenarioKey: importKey,
        source: 'APPROVED_IMPORT',
        sourceRef: 'docs/reglas.md#L10',
        confirmedByUserId: userId,
        confirmedRole: 'ADMIN',
        originHeadSha: 'b'.repeat(40),
      }),
    );
    const stored = await prisma.functionalKnowledge.findUniqueOrThrow({ where: { id: imported.id } });
    expect(stored).toMatchObject({
      source: 'APPROVED_IMPORT',
      sourceRef: 'docs/reglas.md#L10',
      confirmedByUserId: userId,
      confirmedRole: 'ADMIN',
      originHeadSha: 'b'.repeat(40),
      scenarioKey: importKey,
    });

    const rejectedKey = keyOf('audit-rejected');
    await expect(
      repository.create(input({ scenarioKey: rejectedKey, source: 'HUMAN_ANSWER', sourceRef: 'docs/reglas.md' })),
    ).rejects.toThrow(/sourceRef solo se admite/);
    await expect(
      repository.create(input({ scenarioKey: rejectedKey, sourceRef: 'docs/reglas.md' })),
    ).rejects.toThrow(/sourceRef solo se admite/);
    expect(await prisma.functionalKnowledge.count({ where: { projectId, scenarioKey: rejectedKey } })).toBe(0);
  });
});
