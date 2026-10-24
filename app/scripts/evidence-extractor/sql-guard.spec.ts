// WI-CORE-094: pruebas de la guardia de solo lectura. Sin base de datos ni red.
import { describe, expect, it } from 'vitest';
import {
  READ_ONLY_TRANSACTION_STATEMENT,
  ReadOnlyViolation,
  assertControlStatement,
  assertReadOnlySql,
  stripSqlNoise,
} from './sql-guard.mjs';

describe('assertReadOnlySql', () => {
  it.each([
    ['SELECT 1'],
    ['SELECT r."id", r."status" FROM "analysis_runs" r WHERE r."id" = $1'],
    ['WITH x AS (SELECT 1 AS "n") SELECT x."n" FROM x'],
    ["SELECT 'DELETE FROM t' AS \"texto\""],
    ['SELECT "setting", "updatedAt" FROM "tabla_con_nombres_raros"'],
    ['SELECT 1 -- DELETE FROM t'],
    ['SELECT 1 /* INSERT INTO t */'],
    ['SELECT count(*) AS "rowCount" FROM "analysis_runs" WHERE "headSha" <> $1'],
  ])('acepta la consulta de solo lectura %s', (sql) => {
    expect(assertReadOnlySql(sql)).toBe(true);
  });

  it.each([
    ['INSERT INTO "analysis_runs" ("id") VALUES ($1)'],
    ['UPDATE "analysis_runs" SET "status" = $1'],
    ['DELETE FROM "analysis_runs"'],
    ['TRUNCATE "analysis_runs"'],
    ['DROP TABLE "analysis_runs"'],
    ['ALTER TABLE "analysis_runs" ADD COLUMN "x" TEXT'],
    ['CREATE ROLE lector'],
    ['GRANT SELECT ON "analysis_runs" TO lector'],
    ['SELECT 1; DELETE FROM "analysis_runs"'],
    ['SELECT 1;'],
    ['WITH d AS (DELETE FROM "analysis_runs" RETURNING *) SELECT 1'],
    ['SELECT * FROM "analysis_runs" FOR UPDATE'],
    ['SELECT * INTO nueva FROM "analysis_runs"'],
    ['SELECT pg_terminate_backend(1)'],
    ['SELECT set_config(\'x\', \'y\', false)'],
    ['SELECT nextval(\'secuencia\')'],
    ['SET TRANSACTION READ ONLY'],
    ['BEGIN'],
    ['COMMIT'],
    ['COPY "analysis_runs" TO STDOUT'],
    ['SELECT $$texto$$'],
    ['SELECT 1 /* sin cerrar'],
    ["SELECT 'sin cerrar"],
    [''],
  ])('rechaza la sentencia %s', (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow(ReadOnlyViolation);
  });

  it('rechaza valores que no son texto', () => {
    expect(() => assertReadOnlySql(null as unknown as string)).toThrow(ReadOnlyViolation);
  });
});

describe('stripSqlNoise', () => {
  it('quita literales, identificadores y comentarios antes de buscar palabras clave', () => {
    expect(stripSqlNoise('SELECT "DELETE", \'UPDATE\' -- DROP\n/* INSERT */')).not.toMatch(/DELETE|UPDATE|DROP|INSERT/);
  });
});

describe('assertControlStatement', () => {
  it('acepta solo la sentencia de control de la transacción de lectura', () => {
    expect(READ_ONLY_TRANSACTION_STATEMENT).toBe('SET TRANSACTION READ ONLY');
    expect(assertControlStatement('SET TRANSACTION READ ONLY')).toBe(true);
    expect(() => assertControlStatement('SET TRANSACTION READ WRITE')).toThrow(ReadOnlyViolation);
    expect(() => assertControlStatement('COMMIT')).toThrow(ReadOnlyViolation);
  });
});

/** PoC de la revisión de seguridad (WI-CORE-094, SEC-02) y variantes cercanas. Todas deben rechazarse. */
const SECURITY_POCS = [
  'SELECT "pg_terminate_backend"(123)',
  'SELECT "set_config"(\'a\', \'b\', false)',
  'SELECT "nextval"(\'s\')',
  'SELECT "lo_import"(\'/etc/passwd\')',
  'SELECT pg_catalog."pg_terminate_backend"(1)',
  'SELECT pg_terminate_backend(1)',
  "SELECT E'\\'' ; DROP TABLE x; --'",
  "SELECT E'\\''; SELECT pg_terminate_backend(1); --'",
  "SELECT query_to_xml('update x set a=1', true, true, '')",
  'SELECT txid_current()',
  "SELECT current_setting('x')",
  "SELECT \"query_to_json\"('select 1')",
  'SELECT "xmlquery"(\'x\')',
  "SELECT e'abc'",
  "SELECT U&'abc'",
  "SELECT U&'d\\0061t'",
  'SELECT "dblink"(\'x\')',
  "SELECT pg_read_file('/etc/passwd')",
  'SELECT pg_sleep(10)',
  'SELECT "copy"',
  'SELECT "a" ("b")',
  "SELECT * FROM \"t\" WHERE 'x' = $$y$$",
  'SELECT lo_export(1, \'/tmp/x\')',
  'SELECT 1 FROM "t" WHERE x IN (SELECT dblink(\'x\'))',
];

describe('PoC de la revisión de seguridad (SEC-02)', () => {
  it.each(SECURITY_POCS.map((sql) => [sql]))('rechaza %s', (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow(ReadOnlyViolation);
  });

  it('rechaza la barra invertida en cualquier posición (escapes E\'\' y U&)', () => {
    expect(() => assertReadOnlySql('SELECT \'a\\\'b\'')).toThrow(/barra invertida/);
    expect(() => assertReadOnlySql('SELECT 1 -- \\')).toThrow(/barra invertida/);
  });
});

describe('consultas reales del extractor (deben pasar)', () => {
  it('las consultas registradas (datos, sondeo y comprobaciones inversas) pasan la guardia', async () => {
    const { approvedSqlTexts } = await import('./queries.mjs');
    const texts = [...approvedSqlTexts()];
    expect(texts.length).toBeGreaterThan(20);
    for (const sql of texts) {
      expect(() => assertReadOnlySql(sql), sql.slice(0, 80)).not.toThrow();
    }
  });

  it('acepta las llamadas de la lista blanca (count, left, length, CAST, ARRAY, to_regclass)', () => {
    expect(assertReadOnlySql('SELECT count(*) AS "rowCount" FROM "t" WHERE left("a", length(CAST($2 AS TEXT))) <> CAST($2 AS TEXT)')).toBe(true);
    expect(assertReadOnlySql("SELECT to_regclass('public.t') IS NOT NULL AS \"t\"")).toBe(true);
    expect(assertReadOnlySql('SELECT 1 FROM "t" WHERE "x" <@ ARRAY(SELECT "id" FROM "u")')).toBe(true);
  });
});
