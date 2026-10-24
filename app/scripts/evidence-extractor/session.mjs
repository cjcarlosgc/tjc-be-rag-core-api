// WI-CORE-094: sesión de solo lectura sobre PostgreSQL. Secuencia de la transacción:
//   1) BEGIN: lo emite el adaptador (`startTransaction()`).
//   2) SET TRANSACTION READ ONLY: primera sentencia que envía el extractor (lista cerrada de control).
//   3) Solo consultas registradas en queries.mjs, cada una validada por la guardia léxica antes de enviarse.
//   4) ROLLBACK explícito por executeRaw, también ante errores (finally). No se envía COMMIT.
//   5) Liberación de la conexión (`transaction.rollback()` del adaptador solo libera el cliente) y cierre del pool
//      (`dispose()` ejecuta pool.end()).
// La barrera real es READ ONLY; la guardia léxica y la lista de consultas registradas son defensa en profundidad.
// La base se consulta con el rol propietario de Core (las tablas tienen RLS sin políticas, que este rol ignora).
// El script no crea roles ni aplica migraciones.
import { PrismaPg } from '@prisma/adapter-pg';
import {
  assertControlStatement,
  assertReadOnlySql,
  READ_ONLY_TRANSACTION_STATEMENT,
  ReadOnlyViolation,
  ROLLBACK_STATEMENT,
} from './sql-guard.mjs';
import { approvedSqlTexts } from './queries.mjs';

const APPROVED_SQL = approvedSqlTexts();

const ARG_TYPE = Object.freeze({ scalarType: 'string', arity: 'scalar' });

/**
 * Abre un driver de PostgreSQL con el adaptador de Prisma (dependencia directa del proyecto). Devuelve una
 * función que abre el driver; no conecta hasta llamarla. No registra ni expone la URL.
 */
export function openPrismaPgDriver(databaseUrl) {
  return async () => {
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    const driver = await adapter.connect();
    return {
      startTransaction: () => driver.startTransaction(),
      dispose: () => driver.dispose(),
    };
  };
}

/** Convierte un ResultSet del adaptador en objetos por fila; parsea las columnas JSON declaradas en la consulta. */
export function mapRows(definition, resultSet) {
  const jsonColumns = new Set(definition.json ?? []);
  return resultSet.rows.map((row) => {
    const object = {};
    resultSet.columnNames.forEach((name, index) => {
      let value = row[index];
      if (jsonColumns.has(name) && typeof value === 'string') value = JSON.parse(value);
      object[name] = value;
    });
    return object;
  });
}

function createSession(transaction) {
  return {
    /** Ejecuta una consulta de datos declarada en `queries.mjs` y devuelve las filas como objetos. */
    async query(definition, params = []) {
      if (!APPROVED_SQL.has(definition.sql)) throw new ReadOnlyViolation('consulta no registrada en queries.mjs');
      assertReadOnlySql(definition.sql);
      if (!params.every((param) => typeof param === 'string')) {
        throw new TypeError('los parámetros de la consulta deben ser texto');
      }
      const resultSet = await transaction.queryRaw({
        sql: definition.sql,
        args: params,
        argTypes: params.map(() => ARG_TYPE),
      });
      return mapRows(definition, resultSet);
    },
  };
}

/** Envía una sentencia de control de la lista cerrada. */
async function runControl(transaction, sql) {
  assertControlStatement(sql);
  await transaction.executeRaw({ sql, args: [], argTypes: [] });
}

/**
 * Ejecuta `work(session)` dentro de una transacción de solo lectura. Siempre (también si `work` lanza o si el
 * `ROLLBACK` falla) intenta enviar `ROLLBACK` explícito, libera la conexión y cierra el pool. El error de `work`
 * es el que se propaga. `openDriver` devuelve `{ startTransaction, dispose? }`; en producción es
 * `openPrismaPgDriver(...)` y en las pruebas un doble.
 */
export async function runInReadOnlyTransaction(openDriver, work) {
  let driver;
  try {
    driver = await openDriver();
  } catch {
    // El mensaje del adaptador puede describir el destino; se sustituye por una indicación genérica.
    throw new Error('no se pudo abrir la conexión a la base de datos (revisa DATABASE_URL en tu shell)');
  }
  let transaction = null;
  try {
    try {
      transaction = await driver.startTransaction();
    } catch {
      throw new Error('no se pudo iniciar la transacción de solo lectura (revisa DATABASE_URL y la disponibilidad de la base)');
    }
    await runControl(transaction, READ_ONLY_TRANSACTION_STATEMENT);
    return await work(createSession(transaction));
  } finally {
    if (transaction !== null) {
      try {
        await runControl(transaction, ROLLBACK_STATEMENT);
      } catch {
        // Si el ROLLBACK no llega, la conexión ya no es fiable: el cierre del pool la descarta abajo.
      }
      await transaction.rollback().catch(() => {});
    }
    if (typeof driver.dispose === 'function') await driver.dispose().catch(() => {});
  }
}
