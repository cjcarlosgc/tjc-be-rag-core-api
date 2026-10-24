// WI-CORE-094: la sesión de lectura se prueba con un doble del driver de PostgreSQL. Ninguna prueba toca una base real.
import { describe, expect, it } from 'vitest';
import { ReadOnlyViolation, assertControlStatement } from './sql-guard.mjs';
import { mapRows, runInReadOnlyTransaction } from './session.mjs';
import { ANALYSIS_RUN_BY_ID, INVERSE_CHECKS, allDataQueries } from './queries.mjs';

type Statement = { kind: 'begin' | 'executeRaw' | 'queryRaw' | 'release'; sql?: string; args?: string[] };

function createDoubleDriver(rowsBySql: Record<string, unknown[][]> = {}) {
  const log: Statement[] = [];
  const columnNames = ['id', 'payload'];
  const transaction = {
    async executeRaw(query: { sql: string; args: string[] }) {
      log.push({ kind: 'executeRaw', sql: query.sql, args: query.args });
      return 0;
    },
    async queryRaw(query: { sql: string; args: string[] }) {
      log.push({ kind: 'queryRaw', sql: query.sql, args: query.args });
      return { columnNames, columnTypes: [], rows: rowsBySql[query.sql] ?? [] };
    },
    /** El adaptador real solo libera el cliente aquí; NO envía ROLLBACK SQL. */
    async rollback() {
      log.push({ kind: 'release' });
    },
  };
  let disposed = false;
  const driver = {
    async startTransaction() {
      log.push({ kind: 'begin' });
      return transaction;
    },
    async dispose() {
      disposed = true;
    },
  };
  return { log, openDriver: async () => driver, isDisposed: () => disposed };
}

describe('runInReadOnlyTransaction', () => {
  it('secuencia: BEGIN, SET TRANSACTION READ ONLY, consultas, ROLLBACK por SQL y, después, liberación', async () => {
    const double = createDoubleDriver({ [ANALYSIS_RUN_BY_ID.sql]: [['r1', '{"a":1}']] });

    const rows = await runInReadOnlyTransaction(double.openDriver, (session) =>
      session.query(ANALYSIS_RUN_BY_ID, ['r1']),
    );

    expect(double.log.map((entry) => entry.kind)).toEqual(['begin', 'executeRaw', 'queryRaw', 'executeRaw', 'release']);
    expect(double.log[1]).toEqual({ kind: 'executeRaw', sql: 'SET TRANSACTION READ ONLY', args: [] });
    expect(double.log[3]).toEqual({ kind: 'executeRaw', sql: 'ROLLBACK', args: [] });
    expect(rows).toEqual([{ id: 'r1', payload: '{"a":1}' }]);
    expect(double.isDisposed()).toBe(true);
  });

  it('nunca envía COMMIT ni otra sentencia de control fuera de la lista cerrada', async () => {
    const double = createDoubleDriver({ [ANALYSIS_RUN_BY_ID.sql]: [] });
    await runInReadOnlyTransaction(double.openDriver, (session) => session.query(ANALYSIS_RUN_BY_ID, ['r1']));
    const executed = double.log.filter((entry) => entry.kind === 'executeRaw').map((entry) => entry.sql);
    expect(executed).toEqual(['SET TRANSACTION READ ONLY', 'ROLLBACK']);
  });

  it('nunca envía una escritura al driver y aun así envía ROLLBACK', async () => {
    const double = createDoubleDriver();

    await expect(
      runInReadOnlyTransaction(double.openDriver, (session) =>
        session.query({ id: 'malicioso', sql: 'DELETE FROM "analysis_runs"' }),
      ),
    ).rejects.toThrow(ReadOnlyViolation);

    const sent = double.log.filter((entry) => entry.kind === 'queryRaw' || entry.kind === 'executeRaw');
    expect(sent.map((entry) => entry.sql)).toEqual(['SET TRANSACTION READ ONLY', 'ROLLBACK']);
    expect(double.log.at(-1)).toEqual({ kind: 'release' });
    expect(double.isDisposed()).toBe(true);
  });

  it('rechaza una consulta válida pero no registrada en queries.mjs', async () => {
    const double = createDoubleDriver();
    await expect(
      runInReadOnlyTransaction(double.openDriver, (session) => session.query({ id: 'otra', sql: 'SELECT 1' })),
    ).rejects.toThrow(/no registrada/);
    expect(double.log.some((entry) => entry.kind === 'queryRaw')).toBe(false);
  });

  it('rechaza parámetros que no son texto antes de enviar', async () => {
    const double = createDoubleDriver();
    await expect(
      runInReadOnlyTransaction(double.openDriver, (session) => session.query(ANALYSIS_RUN_BY_ID, [42 as unknown as string])),
    ).rejects.toThrow(TypeError);
    expect(double.log.some((entry) => entry.kind === 'queryRaw')).toBe(false);
  });

  it('envía ROLLBACK y libera la conexión aunque la lectura falle a mitad; propaga el error original', async () => {
    const double = createDoubleDriver();
    await expect(
      runInReadOnlyTransaction(double.openDriver, async () => {
        throw new Error('fallo simulado');
      }),
    ).rejects.toThrow('fallo simulado');
    expect(double.log.map((entry) => entry.kind).slice(-2)).toEqual(['executeRaw', 'release']);
    expect(double.log.at(-2)).toEqual({ kind: 'executeRaw', sql: 'ROLLBACK', args: [] });
    expect(double.isDisposed()).toBe(true);
  });

  it('si el ROLLBACK SQL falla, sigue liberando la conexión y propaga el error de la lectura', async () => {
    const log: Statement[] = [];
    const transaction = {
      async executeRaw(query: { sql: string; args: string[] }) {
        log.push({ kind: 'executeRaw', sql: query.sql, args: query.args });
        if (query.sql === 'ROLLBACK') throw new Error('conexión caída');
        return 0;
      },
      async queryRaw() {
        throw new Error('error de la lectura');
      },
      async rollback() {
        log.push({ kind: 'release' });
      },
    };
    const driver = { async startTransaction() { return transaction; }, async dispose() {} };
    await expect(
      runInReadOnlyTransaction(async () => driver, (session) => session.query(ANALYSIS_RUN_BY_ID, ['r1'])),
    ).rejects.toThrow('error de la lectura');
    expect(log.map((entry) => entry.kind)).toEqual(['executeRaw', 'executeRaw', 'release']);
  });
});

describe('sentencias de control', () => {
  it('solo admite SET TRANSACTION READ ONLY y ROLLBACK exactos', () => {
    expect(() => assertControlStatement('SET TRANSACTION READ ONLY')).not.toThrow();
    expect(() => assertControlStatement('ROLLBACK')).not.toThrow();
    for (const sql of ['COMMIT', 'ROLLBACK TO SAVEPOINT x', 'SET TRANSACTION READ WRITE', 'BEGIN', 'RELEASE SAVEPOINT x']) {
      expect(() => assertControlStatement(sql), sql).toThrow(ReadOnlyViolation);
    }
  });
});

describe('mapRows', () => {
  it('parsea solo las columnas JSON declaradas', () => {
    const rows = mapRows(
      { id: 'x', json: ['payload'], sql: 'SELECT 1' },
      { columnNames: ['id', 'payload'], columnTypes: [], rows: [['a', '{"n":1}']] },
    );
    expect(rows).toEqual([{ id: 'a', payload: { n: 1 } }]);
  });

  it('deja intactos los valores de columnas que no son JSON', () => {
    const rows = mapRows(
      { id: 'x', sql: 'SELECT 1' },
      { columnNames: ['id', 'payload'], columnTypes: [], rows: [['a', '{"n":1}']] },
    );
    expect(rows).toEqual([{ id: 'a', payload: '{"n":1}' }]);
  });
});

describe('definiciones de consulta', () => {
  it('todas las consultas de datos y comprobaciones inversas pasan la guardia de solo lectura', async () => {
    const { assertReadOnlySql } = await import('./sql-guard.mjs');
    for (const definition of allDataQueries()) {
      expect(() => assertReadOnlySql(definition.sql), definition.id).not.toThrow();
    }
  });

  it('las comprobaciones inversas usan identificadores entre comillas y comparaciones <> o <@', () => {
    expect(INVERSE_CHECKS.length).toBeGreaterThanOrEqual(7);
    for (const check of INVERSE_CHECKS) {
      expect(check.sql).toMatch(/"analysisRunId"|"analysisSymbolId"|"proposalId"|"headSha"|"sourceHeadSha"|"proposalIds"/);
      expect(check.sql).toMatch(/<>|<@/);
    }
  });
});
