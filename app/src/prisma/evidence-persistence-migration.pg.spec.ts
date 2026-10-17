import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * WI-CORE-027 (DEC-EVID-003): la migración `20261009190000_evidence_persistence` sobre un PostgreSQL LOCAL
 * descartable en el que ya estén aplicadas las migraciones previas. Sin `EVIDENCE_PERSISTENCE_TEST_DATABASE_URL`
 * se omite; la suite nunca toca Supabase ni una base compartida.
 *
 *   EVIDENCE_PERSISTENCE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/ev_test npx vitest run src/prisma/evidence-persistence-migration.pg.spec.ts
 */
const url = process.env.EVIDENCE_PERSISTENCE_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

const COLUMNS: ReadonlyArray<[string, string, string]> = [
  ['analysis_run_executions', 'requestId', 'text'],
  ['analysis_run_executions', 'correlationId', 'text'],
  ['analysis_run_executions', 'durationMs', 'integer'],
  ['analysis_run_executions', 'facts', 'jsonb'],
  ['analysis_run_executions', 'failure', 'jsonb'],
  ['generated_test_proposals', 'generation', 'jsonb'],
  ['experiment_repetitions', 'sandboxExecutionId', 'text'],
  ['experiment_repetitions', 'sandboxRequestId', 'text'],
  ['experiment_repetitions', 'sandboxCorrelationId', 'text'],
  ['experiment_repetitions', 'sandboxFacts', 'jsonb'],
  ['experiment_repetitions', 'artifactHash', 'text'],
];

describe.skipIf(!url)('migración de la evidencia contra PostgreSQL local (WI-CORE-027)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('EVIDENCE_PERSISTENCE_TEST_DATABASE_URL debe apuntar a localhost.');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it.each(COLUMNS)('crea %s.%s como %s nullable', async (table, column, type) => {
    const rows = await prisma.$queryRaw<Array<{ data_type: string; is_nullable: string }>>`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;

    expect(rows).toEqual([{ data_type: type, is_nullable: 'YES' }]);
  });

  it('declara los dos checks con su expresión', async () => {
    const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('analysis_run_executions_durationMs_nonnegative_check', 'experiment_repetitions_artifactHash_sha256_check')
      ORDER BY conname`;

    expect(rows.map((row) => row.conname)).toEqual([
      'analysis_run_executions_durationMs_nonnegative_check',
      'experiment_repetitions_artifactHash_sha256_check',
    ]);
  });
});
