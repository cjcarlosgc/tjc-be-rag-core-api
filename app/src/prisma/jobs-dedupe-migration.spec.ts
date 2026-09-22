import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 014 (HU61, corte 5a): Prisma no declara índices únicos parciales, así que la migración SQL
// es la única fuente. El índice cubre SOLO filas PENDING con `dedupeKey` no nula (nunca RUNNING):
// la siguiente ocurrencia de la reconciliación se encola al inicio de su ejecución sin chocar
// con su propia fila RUNNING. Validada, además, contra un PostgreSQL local descartable
// (`jobs.repository.pg.spec.ts`, con `JOBS_TEST_DATABASE_URL`).
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');
const migration = readFileSync(join(prismaDir, 'migrations', '20260921160000_jobs_dedupe_key', 'migration.sql'), 'utf8').replace(
  /--.*$/gm,
  '',
);
const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
const jobModel = /^model Job \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? '';

describe('migración de jobs.dedupeKey', () => {
  it('agrega la columna nullable de texto, sin backfill ni NOT NULL', () => {
    expect(migration).toMatch(/ALTER TABLE "jobs" ADD COLUMN "dedupeKey" TEXT;/);
    expect(migration).not.toMatch(/\bUPDATE\b|\bINSERT\b/i);
    expect(/ALTER TABLE[^;]*;/.exec(migration)?.[0]).not.toMatch(/NOT NULL/i);
    expect(jobModel).toMatch(/dedupeKey\s+String\?/);
  });

  it('crea un índice único PARCIAL solo sobre PENDING con dedupeKey no nula (no RUNNING)', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "jobs_dedupeKey_pending_key" ON "jobs"\("dedupeKey"\)\s+WHERE "status" = 'PENDING' AND "dedupeKey" IS NOT NULL;/,
    );
    const uniqueIndexes = migration.match(/CREATE UNIQUE INDEX[\s\S]*?;/g) ?? [];
    expect(uniqueIndexes).toHaveLength(1);
    expect(uniqueIndexes[0]).not.toMatch(/RUNNING/);
  });

  it('el schema no declara una unicidad de dedupeKey (sería total, no parcial) ni una tabla nueva', () => {
    expect(jobModel).not.toMatch(/@unique|@@unique/);
    expect(migration).not.toMatch(/CREATE TABLE/);
  });
});
