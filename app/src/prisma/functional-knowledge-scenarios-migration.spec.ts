import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WI-CORE-020 (DEC-FK-005; HU07, HU09): la migración de escenarios no cambia `status`, aborta con un listado
// determinista cuando hay duplicados ACTIVE y solo crea el índice único parcial sin duplicados. El comportamiento
// real contra PostgreSQL lo valida app/prisma/validation/validate-functional-knowledge-scenarios.sh (fuera de
// `pnpm test`). Aquí se comprueba el SQL versionado.
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');
const stripComments = (sql: string): string => sql.replace(/--.*$/gm, '');
const migration = stripComments(
  readFileSync(join(prismaDir, 'migrations', '20261008150000_functional_knowledge_scenarios', 'migration.sql'), 'utf8'),
);
const preflight = stripComments(
  readFileSync(join(prismaDir, 'preflight', '20261008150000_functional_knowledge_active_duplicates.sql'), 'utf8'),
);

describe('migración de escenarios de Functional Knowledge (DEC-FK-005)', () => {
  it('nunca modifica status ni marca SUPERSEDED automáticamente', () => {
    const updates = migration.match(/UPDATE[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update).not.toMatch(/SET[\s\S]*"status"\s*=/);
    }
    expect(migration).not.toMatch(/'SUPERSEDED'/);
  });

  it('aborta con RAISE EXCEPTION y un listado ordenado por identidad y por createdAt/id', () => {
    expect(migration).toMatch(/RAISE EXCEPTION/);
    expect(migration).toMatch(/ORDER BY "projectId", "scope", "targetKey", "scenarioKey"/);
    expect(migration).toMatch(/string_agg\("id", ',' ORDER BY "createdAt", "id"\)/);
    expect(migration).toMatch(/USING HINT = '[^']*SUPERSEDE[^']*KEEP_EXISTING[^']*'/);
  });

  it("usa la identidad (projectId, scope, COALESCE(targetRef, ''), scenarioKey) y solo entre ACTIVE", () => {
    expect(migration).toMatch(/GROUP BY "projectId", "scope", COALESCE\("targetRef", ''\), "scenarioKey"/);
    expect(migration).toMatch(/WHERE "status" = 'ACTIVE'\s+GROUP BY/);
    expect(migration).toMatch(/HAVING count\(\*\) > 1/);
  });

  it('el backfill solo rellena columnas NULL con EXPECTED_RESULT/LEGACY', () => {
    expect(migration).toMatch(/COALESCE\("scenarioKind", 'EXPECTED_RESULT'\)/);
    expect(migration).toMatch(/COALESCE\("scenarioKey", 'LEGACY'\)/);
  });

  it('NOT NULL y el índice único parcial van después de la detección de duplicados', () => {
    const detection = migration.indexOf('RAISE EXCEPTION');
    const notNull = migration.indexOf('SET NOT NULL');
    const index = migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "functional_knowledge_active_scenario_key"');
    expect(detection).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(detection);
    expect(index).toBeGreaterThan(notNull);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "functional_knowledge_active_scenario_key"\s+ON "functional_knowledge" \("projectId", "scope", \(COALESCE\("targetRef", ''\)\), "scenarioKey"\)\s+WHERE "status" = 'ACTIVE';/,
    );
  });

  it('es re-ejecutable: columnas con IF NOT EXISTS y sin CREATE TABLE', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "scenarioKind"/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "scenarioKey"/);
    expect(migration).not.toMatch(/CREATE TABLE/);
  });
});

describe('consulta preflight de duplicados ACTIVE (solo lectura)', () => {
  it('es de solo lectura: sin escrituras ni DDL y con la sesión forzada a READ ONLY', () => {
    expect(preflight).toMatch(/SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY/);
    expect(preflight).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT)\b/i);
  });

  it('reporta el mismo formato de línea y el mismo orden que el abort de la migración', () => {
    const line = "'projectId=%s scope=%s targetRef=%L scenarioKey=%s activeCount=%s activeIds=%s'";
    expect(migration).toContain(line);
    expect(preflight).toContain(line);
    expect(preflight).toMatch(/ORDER BY "projectId", "scope", "targetKey";/);
    expect(preflight).toMatch(/string_agg\("id", ',' ORDER BY "createdAt", "id"\)/);
  });
});
