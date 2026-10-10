/**
 * WI-CORE-007 (HU12/HU17; INTEROP-2.7 §6.16): saneado del `failureMessage` antes de persistirlo.
 *
 * Orden fijo: normaliza caracteres de control (acotando la entrada a FAILURE_MESSAGE_SCAN_MAX_LENGTH puntos
 * de código antes de cualquier expresión regular), redacta secretos con una lista cerrada de patrones y solo
 * después trunca a 500 caracteres, para que ningún secreto quede cortado a medias. Es una función pura e
 * idempotente: sanear dos veces produce el mismo resultado. WI-CORE-027 la reutiliza para la evidencia de un
 * AnalysisRun, así que no debe cambiarse sin revisar ambos consumidores.
 */

export const FAILURE_MESSAGE_MAX_LENGTH = 500;

/**
 * Tope de entrada en puntos de código, aplicado antes de las expresiones regulares para acotar su coste
 * (WI-CORE-007, revisión ciclo 1). Si el tope corta el texto, el último token (desde el último espacio) se
 * descarta entero: así no queda un fragmento de secreto visible. El tope protege el coste, no sustituye a la
 * redacción, y la salida solo conserva 500 caracteres.
 */
export const FAILURE_MESSAGE_SCAN_MAX_LENGTH = 16_384;

const REDACTED = '[REDACTED]';

/**
 * Bloques de clave privada PEM o PGP, sin distinguir mayúsculas (ya sin saltos de línea tras normalizar). Un
 * bloque sin cierre consume hasta el final del texto analizado.
 */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/gi;

/**
 * Pares `CLAVE=valor`, `CLAVE: valor` o JSON `"clave":"valor"` cuya clave contiene un nombre sensible. Conserva
 * la clave y sustituye el valor. El valor puede ser:
 * - una cadena entre comillas dobles o simples, con escapes (`\"`); sin cierre, llega hasta el final;
 * - una lista `[...]`, que se sustituye entera (así cubre `["a","b"]`); sin cierre, llega hasta el final;
 * - un token sin espacios ni delimitadores, opcionalmente precedido por `Basic|Bearer|Token|Digest`.
 * No captura el prefijo de la clave (`DATABASE_` en `DATABASE_PASSWORD=`): la sustitución lo conserva tal cual.
 * Las alternativas empiezan por caracteres distintos o terminan en `$`, así que el coste es lineal.
 */
const SENSITIVE_PAIR =
  /((?:password|passwd|pwd|secret|token|key|authorization)["']?\s*[:=]\s*)(?:"(?:[^"\\]|\\[\s\S]?)*(?:"|$)|'(?:[^'\\]|\\[\s\S]?)*(?:'|$)|\[(?:[^\]"]|"(?:[^"\\]|\\[\s\S]?)*(?:"|$))*\]?|(?:(?:basic|bearer|token|digest)\s+)?[^\s,;&"']+)/gi;

const BEARER_TOKEN = /\bBearer\s+[\w.~+/-]+=*/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const OPENAI_STYLE_KEY = /\bsk-[\w-]{8,}/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_\w{10,})/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
/**
 * Inicio de un esquema de URL (`https://`). El lookbehind hace que solo se empiece al principio de cada
 * esquema, de modo que el recorrido de un token es lineal.
 */
const URL_SCHEME = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Orden de aplicación: las URL se procesan antes que los pares, para que `https://u:a=b@host` no deje el
 * nombre de usuario visible. Después, el par `Authorization: Bearer x` debe consumirse antes que `Bearer x`.
 */
const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [PRIVATE_KEY_BLOCK, REDACTED],
  [SENSITIVE_PAIR, `$1${REDACTED}`],
  [BEARER_TOKEN, `Bearer ${REDACTED}`],
  [JWT, REDACTED],
  [OPENAI_STYLE_KEY, REDACTED],
  [GITHUB_TOKEN, REDACTED],
  [AWS_ACCESS_KEY, REDACTED],
];

/** Tabulador, salto de línea, retorno de carro, tabulador vertical y de página: se convierten en espacio. */
const WHITESPACE_CONTROL_CODES = new Set([9, 10, 11, 12, 13]);

function normalizeControlCharacters(text: string): string {
  let normalized = '';
  let scanned = 0;
  let truncated = false;
  for (const char of text) {
    if (scanned === FAILURE_MESSAGE_SCAN_MAX_LENGTH) {
      truncated = true;
      break;
    }
    scanned += 1;
    const code = char.codePointAt(0) ?? 0;
    if (WHITESPACE_CONTROL_CODES.has(code)) {
      normalized += ' ';
    } else if (code < 0x20 || code === 0x7f) {
      // Resto de caracteres de control: se eliminan.
    } else {
      normalized += char;
    }
  }
  if (truncated) {
    // El tope puede cortar un token a mitad: se descarta desde el último espacio para no mostrar un fragmento.
    const lastSpace = normalized.lastIndexOf(' ');
    if (lastSpace !== -1) normalized = normalized.slice(0, lastSpace);
  }
  return normalized;
}

/**
 * Credenciales `usuario:clave@` y query o fragmento de una URL, dentro de un token sin espacios. Quita todo el
 * authority hasta el último `@` del token (la clave puede contener `/` o `@`) y después la query y el fragmento.
 */
function redactUrlToken(token: string): string {
  const scheme = URL_SCHEME.exec(token);
  if (scheme === null) return token;
  const authorityStart = scheme.index + scheme[0].length;
  let rest = token.slice(authorityStart);
  const lastAt = rest.lastIndexOf('@');
  if (lastAt !== -1) rest = `${REDACTED}@${rest.slice(lastAt + 1)}`;
  const queryStart = rest.search(/[?#]/);
  if (queryStart !== -1) rest = rest.slice(0, queryStart);
  return token.slice(0, authorityStart) + rest;
}

/**
 * Devuelve el mensaje sin secretos y con como máximo 500 caracteres (puntos de código, no unidades UTF-16).
 * Un mensaje sin secretos, sin caracteres de control y de hasta 500 caracteres vuelve idéntico.
 */
export function sanitizeFailureMessage(message: string): string {
  const scanned = normalizeControlCharacters(message).replace(/\S+/g, redactUrlToken);
  const redacted = REDACTION_RULES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    scanned,
  );
  return Array.from(redacted).slice(0, FAILURE_MESSAGE_MAX_LENGTH).join('');
}
