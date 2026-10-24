// WI-CORE-094: guardia léxica de solo lectura. Es una SEGUNDA barrera: la barrera real es la transacción
// `SET TRANSACTION READ ONLY` (ver `session.mjs`) y, además, `session.mjs` solo envía consultas registradas en
// `queries.mjs`. La guardia rechaza, sin ejecutar nada, cualquier texto que no sea una única sentencia SELECT/WITH
// sin escrituras, sin llamadas a funciones fuera de una lista blanca y sin construcciones de escape que oculten
// el resto de la sentencia (E'...', U&'...', barras invertidas, `$$`).
//
// Enfoque: se recorre el SQL carácter a carácter. Literales -> `''`, identificadores entre comillas -> `""` (pero
// su NOMBRE se examina aparte: `"pg_terminate_backend"(1)` es una llamada), comentarios -> espacio. Después se
// buscan palabras clave y llamadas sobre esa estructura.

export class ReadOnlyViolation extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReadOnlyViolation';
  }
}

/**
 * Lista cerrada de sentencias de control que el extractor envía por `executeRaw`. `BEGIN` lo emite el adaptador;
 * `COMMIT` nunca se envía. `ROLLBACK` se envía explícitamente antes de liberar la conexión.
 */
export const READ_ONLY_TRANSACTION_STATEMENT = 'SET TRANSACTION READ ONLY';
export const ROLLBACK_STATEMENT = 'ROLLBACK';
const CONTROL_STATEMENTS = Object.freeze([READ_ONLY_TRANSACTION_STATEMENT, ROLLBACK_STATEMENT]);

const FORBIDDEN_WORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE',
  'COPY', 'CALL', 'DO', 'VACUUM', 'ANALYZE', 'REINDEX', 'CLUSTER', 'LOCK', 'COMMENT', 'SET', 'RESET', 'BEGIN',
  'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'NOTIFY', 'LISTEN',
  'UNLISTEN', 'REFRESH', 'IMPORT', 'REASSIGN', 'DISCARD', 'LOAD', 'RETURNING', 'EXPLAIN', 'SECURITY', 'OWNER',
];
const FORBIDDEN_WORD_PATTERN = new RegExp(`\\b(?:${FORBIDDEN_WORDS.join('|')})\\b`, 'i');

/** Prefijos de sistema o de enlace externo: no se permiten ni como nombre de función ni como identificador. */
const FORBIDDEN_NAME_PREFIX = /^(?:pg_|lo_|dblink)/i;
const FORBIDDEN_NAME_PREFIX_IN_STRUCTURE = /\b(?:pg_|lo_|dblink)\w*/i;

/**
 * Únicas funciones que pueden llamarse. Son las que usan las consultas constantes del extractor. Cualquier otra
 * llamada (incluidas `query_to_xml`, `txid_current`, `current_setting`, `set_config`, `nextval`) se rechaza.
 */
const ALLOWED_CALLS = new Set(['count', 'left', 'length', 'cast', 'array', 'to_regclass']);

/** Palabras que pueden ir seguidas de `(` sin ser una llamada a función (`IN (...)`, `NOT (...)`, etc.). */
const KEYWORDS_BEFORE_PAREN = new Set([
  'in', 'and', 'or', 'not', 'on', 'where', 'from', 'join', 'select', 'as', 'any', 'all', 'exists', 'values', 'with',
  'using', 'having', 'by', 'is', 'when', 'then', 'else', 'case', 'over', 'filter', 'distinct', 'limit', 'order',
]);

const STRING_PREFIX_BEFORE_QUOTE = /(?:^|[^A-Za-z0-9_])[EeBbXx]$/;
const UNICODE_PREFIX = /U&$/i;

/**
 * Recorre el SQL y devuelve la estructura sin literales ni comentarios, la lista de identificadores entre comillas
 * con su nombre y si van seguidos de `(`. Lanza `ReadOnlyViolation` ante construcciones de escape o sin cerrar.
 */
export function tokenizeSql(sql) {
  if (typeof sql !== 'string') throw new ReadOnlyViolation('la consulta no es texto');
  if (sql.includes('\\')) throw new ReadOnlyViolation('barra invertida no permitida (escapes)');
  let out = '';
  const quotedNames = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" || char === '"') {
      if (char === "'" && STRING_PREFIX_BEFORE_QUOTE.test(out)) {
        throw new ReadOnlyViolation('prefijo de cadena no permitido (E, B, X)');
      }
      if (UNICODE_PREFIX.test(out)) throw new ReadOnlyViolation('prefijo Unicode no permitido (U&)');
      let j = i + 1;
      let name = '';
      let closed = false;
      while (j < sql.length) {
        if (sql[j] === char) {
          if (sql[j + 1] === char) {
            name += char;
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        name += sql[j];
        j += 1;
      }
      if (!closed) throw new ReadOnlyViolation('literal o identificador sin cerrar');
      if (char === '"') {
        let k = j + 1;
        while (k < sql.length && /\s/.test(sql[k])) k += 1;
        quotedNames.push({ name, followedByParen: sql[k] === '(' });
        out += '""';
      } else {
        out += "''";
      }
      i = j + 1;
    } else if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      out += ' ';
    } else if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new ReadOnlyViolation('comentario sin cerrar');
      i = end + 2;
      out += ' ';
    } else {
      out += char;
      i += 1;
    }
  }
  return { structure: out, quotedNames };
}

/** Quita literales, identificadores entre comillas y comentarios. Se conserva por compatibilidad con las pruebas. */
export function stripSqlNoise(sql) {
  return tokenizeSql(sql).structure;
}

/**
 * Lanza `ReadOnlyViolation` si `sql` no es una única sentencia SELECT (o WITH) de solo lectura con llamadas de la
 * lista blanca. Devuelve `true` cuando la consulta pasa. Se llama antes de cada envío, nunca después.
 */
export function assertReadOnlySql(sql) {
  const { structure, quotedNames } = tokenizeSql(sql);
  const trimmed = structure.trim();
  if (trimmed.includes(';')) throw new ReadOnlyViolation('solo se permite una sentencia por consulta');
  if (!/^(?:SELECT|WITH)\b/i.test(trimmed)) throw new ReadOnlyViolation('solo se permiten consultas SELECT');

  const word = FORBIDDEN_WORD_PATTERN.exec(trimmed);
  if (word) throw new ReadOnlyViolation(`palabra clave no permitida en una consulta de solo lectura: ${word[0].toUpperCase()}`);
  if (/\$(?!\d)/.test(trimmed)) throw new ReadOnlyViolation('dollar-quoting o marcador no permitido');
  if (/\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b/i.test(trimmed)) {
    throw new ReadOnlyViolation('bloqueo de filas (FOR UPDATE/SHARE) no permitido');
  }
  if (/\bINTO\b/i.test(trimmed)) throw new ReadOnlyViolation('SELECT ... INTO no permitido');
  if (FORBIDDEN_NAME_PREFIX_IN_STRUCTURE.test(trimmed)) {
    throw new ReadOnlyViolation('función o nombre de sistema no permitido');
  }

  for (const identifier of quotedNames) {
    if (FORBIDDEN_NAME_PREFIX.test(identifier.name) || FORBIDDEN_WORDS.includes(identifier.name.toUpperCase())) {
      throw new ReadOnlyViolation('identificador entrecomillado no permitido');
    }
    if (identifier.followedByParen && !ALLOWED_CALLS.has(identifier.name.toLowerCase())) {
      throw new ReadOnlyViolation(`llamada a función no permitida: ${identifier.name}`);
    }
  }
  for (const match of trimmed.matchAll(/([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g)) {
    const name = match[1].toLowerCase();
    if (KEYWORDS_BEFORE_PAREN.has(name)) continue;
    if (!ALLOWED_CALLS.has(name)) throw new ReadOnlyViolation(`llamada a función no permitida: ${match[1]}`);
  }
  return true;
}

/** Acepta solo las sentencias de control de la lista cerrada (`SET TRANSACTION READ ONLY`, `ROLLBACK`). */
export function assertControlStatement(sql) {
  if (!CONTROL_STATEMENTS.includes(sql)) {
    throw new ReadOnlyViolation('sentencia de control no permitida');
  }
  return true;
}
