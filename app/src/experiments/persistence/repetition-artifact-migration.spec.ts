import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WI-CORE-053: la migración de experiment_repetition_artifacts debe ser estrictamente aditiva. Solo puede crear
 * la tabla nueva, sus índices, su FK y RLS. Ninguna sentencia puede tocar tablas existentes ni filas.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  '../../../prisma/migrations/20261013100000_experiment_repetition_artifacts/migration.sql',
);

function executableStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0);
}

describe('migración experiment_repetition_artifacts (WI-CORE-053)', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const statements = executableStatements(sql);

  it('no contiene DROP, DELETE, UPDATE, TRUNCATE ni ALTER sobre tablas existentes', () => {
    // Las cláusulas referenciales `ON DELETE|UPDATE ...` de la FK no son sentencias DML.
    const body = statements.join(' ; ').replace(/ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|SET DEFAULT|NO ACTION)/gi, '');
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/\bDELETE\b/i);
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bINSERT\b/i);
  });

  it('solo altera la tabla nueva', () => {
    const alters = statements.filter((statement) => /^ALTER TABLE/i.test(statement));
    expect(alters.length).toBeGreaterThan(0);
    for (const alter of alters) {
      expect(alter).toMatch(/^ALTER TABLE "experiment_repetition_artifacts" (ADD CONSTRAINT|ENABLE ROW LEVEL SECURITY)/i);
    }
  });

  it('solo crea la tabla, sus índices y su FK, y activa RLS', () => {
    const creates = statements.filter((statement) => /^CREATE/i.test(statement));
    expect(creates.map((statement) => statement.split(' (')[0])).toEqual([
      'CREATE TABLE "experiment_repetition_artifacts"',
      'CREATE UNIQUE INDEX "experiment_repetition_artifacts_repetitionId_key" ON "experiment_repetition_artifacts"("repetitionId")',
    ]);
    expect(statements.some((statement) => /ENABLE ROW LEVEL SECURITY/i.test(statement))).toBe(true);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.%I FROM %I/);
    expect(sql).toMatch(/ARRAY\['anon', 'authenticated'\]/);
  });

  it('la FK de la tabla nueva es ON DELETE CASCADE hacia experiment_repetitions', () => {
    const fk = statements.find((statement) => /FOREIGN KEY/i.test(statement));
    expect(fk).toBe(
      'ALTER TABLE "experiment_repetition_artifacts" ADD CONSTRAINT "experiment_repetition_artifacts_repetitionId_fkey" FOREIGN KEY ("repetitionId") REFERENCES "experiment_repetitions"("id") ON DELETE CASCADE ON UPDATE CASCADE',
    );
  });
});
