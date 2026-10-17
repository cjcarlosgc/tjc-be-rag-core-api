import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WI-CORE-027 (DEC-EVID-003): migración aditiva de la evidencia. Solo columnas nuevas y nullables, sin backfill ni
// tablas nuevas. La validación contra PostgreSQL real vive en `evidence-persistence-migration.pg.spec.ts`.
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');
const raw = readFileSync(join(prismaDir, 'migrations', '20261009190000_evidence_persistence', 'migration.sql'), 'utf8');
const migration = raw.replace(/--.*$/gm, '');
const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');

function modelBody(name: string): string {
  return new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1] ?? '';
}

describe('migración de la evidencia (WI-CORE-027, DEC-EVID-003)', () => {
  it('solo añade columnas nullables, sin NOT NULL ni valores por defecto', () => {
    const statements = migration.match(/ALTER TABLE[\s\S]*?;/g) ?? [];
    const additions = statements.filter((statement) => /ADD COLUMN/.test(statement));

    expect(additions).toHaveLength(3);
    for (const statement of additions) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT/i);
    }
  });

  it('añade exactamente las columnas de DEC-EVID-003 en sus tablas', () => {
    expect(migration).toMatch(/ALTER TABLE "analysis_run_executions" ADD COLUMN "requestId" TEXT,\s*ADD COLUMN "correlationId" TEXT,\s*ADD COLUMN "durationMs" INTEGER,\s*ADD COLUMN "facts" JSONB,\s*ADD COLUMN "failure" JSONB;/);
    expect(migration).toMatch(/ALTER TABLE "generated_test_proposals" ADD COLUMN "generation" JSONB;/);
    expect(migration).toMatch(
      /ALTER TABLE "experiment_repetitions" ADD COLUMN "sandboxExecutionId" TEXT,\s*ADD COLUMN "sandboxRequestId" TEXT,\s*ADD COLUMN "sandboxCorrelationId" TEXT,\s*ADD COLUMN "sandboxFacts" JSONB,\s*ADD COLUMN "artifactHash" TEXT;/,
    );
  });

  it('no hace backfill, no crea tablas y no abre RLS nuevo', () => {
    expect(migration).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
    expect(migration).not.toMatch(/CREATE TABLE|ENABLE ROW LEVEL SECURITY|CREATE POLICY/i);
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it('declara checks que solo aceptan valores observados: duración no negativa y hash SHA-256', () => {
    expect(migration).toMatch(/CHECK \("durationMs" >= 0\)/);
    expect(migration).toMatch(/CHECK \("artifactHash" IS NULL OR "artifactHash" ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it('documenta el rollback manual en el encabezado, con las columnas a retirar', () => {
    for (const column of ['requestId', 'correlationId', 'durationMs', 'facts', 'failure', 'generation', 'sandboxExecutionId', 'sandboxRequestId', 'sandboxCorrelationId', 'sandboxFacts', 'artifactHash']) {
      expect(raw).toContain(`DROP COLUMN "${column}"`);
    }
  });

  it('el schema declara los mismos campos como opcionales en sus modelos', () => {
    const execution = modelBody('AnalysisRunExecution');
    const proposal = modelBody('GeneratedTestProposal');
    const repetition = modelBody('ExperimentRepetition');

    expect(execution).toMatch(/requestId\s+String\?/);
    expect(execution).toMatch(/correlationId\s+String\?/);
    expect(execution).toMatch(/durationMs\s+Int\?/);
    expect(execution).toMatch(/facts\s+Json\?/);
    expect(execution).toMatch(/failure\s+Json\?/);
    expect(proposal).toMatch(/generation\s+Json\?/);
    expect(repetition).toMatch(/sandboxExecutionId\s+String\?/);
    expect(repetition).toMatch(/sandboxRequestId\s+String\?/);
    expect(repetition).toMatch(/sandboxCorrelationId\s+String\?/);
    expect(repetition).toMatch(/sandboxFacts\s+Json\?/);
    expect(repetition).toMatch(/artifactHash\s+String\?/);
  });
});
