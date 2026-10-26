// WI-CORE-107: acceso de solo lectura para los dos volcados desde base. Reutiliza la sesión del extractor
// (`runInReadOnlyTransaction`: SET TRANSACTION READ ONLY, consultas registradas, ROLLBACK). No carga .env: la URL llega
// de `DATABASE_URL` del entorno y nunca se imprime.
import { openPrismaPgDriver, runInReadOnlyTransaction } from '../evidence-extractor/session.mjs';

export class Oe2ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Oe2ConfigError';
  }
}

/** Exige `DATABASE_URL` (solo para los subcomandos que leen la base). El mensaje no contiene el valor. */
export function requireDatabaseUrl(env) {
  if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.length === 0) {
    throw new Oe2ConfigError('falta DATABASE_URL en el entorno: expórtala en tu shell (el script no carga .env)');
  }
  return env.DATABASE_URL;
}

/** Ejecuta `work(session)` dentro de la transacción de solo lectura del extractor. */
export function readOnlySession({ openDriver = openPrismaPgDriver, env, work }) {
  const url = requireDatabaseUrl(env);
  return runInReadOnlyTransaction(openDriver(url), work);
}

/** Fecha de la base como ISO-8601 (acepta `Date` o texto ya formateado); `null` si no hay valor. */
export function toIsoOrNull(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Array de texto de la base (text[]); el adaptador entrega arrays. Cualquier otra forma es un error. */
export function toTextArray(value, label) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label}: formato de array no esperado`);
  return value.map((item) => String(item));
}
