import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WI-CORE-060: la migración de reconstrucción de trials debe ser estrictamente aditiva. Solo puede añadir
 * columnas nullables (sin DEFAULT, sin NOT NULL) a tres tablas existentes. Ninguna sentencia puede borrar,
 * reescribir filas ni cambiar tipos.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  '../../../prisma/migrations/20261013110000_experiment_trial_reconstruction/migration.sql',
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

describe('migración experiment_trial_reconstruction (WI-CORE-060)', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const statements = executableStatements(sql);

  it('no contiene DROP, DELETE, UPDATE, TRUNCATE, INSERT, ALTER TYPE ni DEFAULT', () => {
    const body = statements.join(' ; ');
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/\bDELETE\b/i);
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bINSERT\b/i);
    expect(body).not.toMatch(/\bTYPE\b/i);
    expect(body).not.toMatch(/\bDEFAULT\b/i);
    expect(body).not.toMatch(/\bNOT NULL\b/i);
  });

  it('solo contiene sentencias ALTER TABLE ... ADD COLUMN sobre las tres tablas previstas', () => {
    expect(statements.every((statement) => /^ALTER TABLE "[a-z_]+" ADD COLUMN /i.test(statement))).toBe(true);
    const tables = statements.map((statement) => statement.match(/^ALTER TABLE "([a-z_]+)"/i)?.[1]);
    expect(tables).toEqual([
      'experiment_runs',
      'experiment_repetitions',
      'experiment_repetition_artifacts',
    ]);
  });

  it('añade exactamente las columnas previstas, todas nullables', () => {
    const columns = statements.flatMap((statement) => {
      const table = statement.match(/^ALTER TABLE "([a-z_]+)"/i)?.[1];
      const defs = statement.replace(/^ALTER TABLE "[a-z_]+" /i, '').split(/ADD COLUMN /i).slice(1);
      return defs.map((def) => {
        const [, name, type] = def.match(/^"([A-Za-z0-9]+)" (\w+(?:\(\d+\))?)/) ?? [];
        return `${table}.${name}:${type}`;
      });
    });
    expect(columns).toEqual([
      'experiment_runs.analysisRunId:TEXT',
      'experiment_runs.commitSha:TEXT',
      'experiment_repetitions.finishedAt:TIMESTAMP(3)',
      'experiment_repetitions.promptSha256:TEXT',
      'experiment_repetitions.startedAt:TIMESTAMP(3)',
      'experiment_repetition_artifacts.sandboxCompletedAt:TIMESTAMP(3)',
      'experiment_repetition_artifacts.sandboxEvidence:JSONB',
      'experiment_repetition_artifacts.sandboxEvidenceSha256:TEXT',
      'experiment_repetition_artifacts.sandboxEvidenceTruncated:BOOLEAN',
      'experiment_repetition_artifacts.sandboxStartedAt:TIMESTAMP(3)',
    ]);
  });

  it('documenta el rollback manual con DROP COLUMN en la cabecera', () => {
    expect(sql).toMatch(/^--\s+ALTER TABLE "experiment_repetition_artifacts" DROP COLUMN/m);
    expect(sql).toMatch(/^--\s+ALTER TABLE "experiment_runs" DROP COLUMN/m);
  });
});
