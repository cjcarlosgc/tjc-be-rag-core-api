// WI-CORE-105 (D-v2-6): reglas `ENV_SUSPECT`, declaradas ex ante y SOLO INFORMATIVAS. Marcan una repetición cuyo fallo
// PARECE de entorno (no de la estrategia) para que el operador la revise a mano. No son veredicto, no clasifican el
// fallo en el producto, no se usan para puntuar ni para excluir repeticiones de VT. Función pura, sin E/S.
//
// Reglas (se evalúan sobre `failureType` y `errorSummary` de la repetición):
//   ENV-01  failureType ∈ {TEST_RUNTIME, COMPILATION}, el texto contiene `failed to open stream` o
//           `no such file or directory` Y menciona una ruta bajo `/app/` (archivo o recurso del proyecto que el
//           Sandbox no recibió, p. ej. fixtures que no viajaron en el snapshot).
//   ENV-03  el texto contiene `allowed memory size` o `memory_limit` (límite de memoria de PHP en el Sandbox).
//   ENV-04  el texto contiene `could not resolve host`, `connection timed out|refused` o `curl error <n>` (red o
//           resolución al instalar dependencias).
// (No existe ENV-02: la numeración se conserva tal como se aprobó.)
//
// NO se marcan, a propósito, porque también pueden ser fallo de la estrategia:
//   - `runner results file is empty`: lo produce también un `Fatal error` del código generado (p. ej. métodos
//     abstractos sin implementar).
//   - `Class "…" not found`: puede ser una clase inventada por la estrategia.
export const ENV_RULES = Object.freeze({
  'ENV-01': 'archivo o recurso bajo /app/ no encontrado (Failed to open stream / No such file or directory)',
  'ENV-03': 'límite de memoria de PHP',
  'ENV-04': 'fallo de red o de resolución de nombres',
});

const ENV_01_FAILURE_TYPES = new Set(['TEST_RUNTIME', 'COMPILATION']);
const ENV_01_TEXT = /(failed to open stream|no such file or directory)/i;
// `/app/` como inicio de ruta: no precedido por un carácter de ruta (así `/var/app/x` no cuenta).
const APP_PATH = /(?<![\w./-])\/app\/\S/;
const ENV_03_TEXT = /(allowed memory size|memory_limit)/i;
const ENV_04_TEXT = /(could not resolve host|connection (timed out|refused)|curl error \d+)/i;

/** Identificadores de las reglas que marcan la repetición (arreglo vacío si ninguna). Nunca lanza. */
export function detectEnvSuspect({ failureType, errorSummary } = {}) {
  const text = typeof errorSummary === 'string' ? errorSummary : '';
  const ids = [];
  if (ENV_01_FAILURE_TYPES.has(failureType) && ENV_01_TEXT.test(text) && APP_PATH.test(text)) ids.push('ENV-01');
  if (ENV_03_TEXT.test(text)) ids.push('ENV-03');
  if (ENV_04_TEXT.test(text)) ids.push('ENV-04');
  return ids;
}
