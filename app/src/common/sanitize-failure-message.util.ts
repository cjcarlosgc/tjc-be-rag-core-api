/**
 * WI-CORE-007 (HU12/HU17; INTEROP-2.7 §6.16): saneado del `failureMessage` antes de persistirlo.
 *
 * Orden fijo: normaliza caracteres de control, redacta secretos con una lista cerrada de patrones y
 * solo después trunca a 500 caracteres, para que ningún secreto quede cortado a medias. Es una función
 * pura e idempotente: sanear dos veces produce el mismo resultado. WI-CORE-027 la reutiliza para la
 * evidencia de un AnalysisRun, así que no debe cambiarse sin revisar ambos consumidores.
 */

export const FAILURE_MESSAGE_MAX_LENGTH = 500;

const REDACTED = '[REDACTED]';

/** Bloques de clave privada PEM (ya sin saltos de línea tras normalizar). */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g;

/**
 * Pares `CLAVE=valor`, `CLAVE: valor` o JSON `"clave":"valor"` cuya clave contiene un nombre sensible.
 * Conserva la clave y sustituye el valor. Un valor `Basic|Bearer|Token|Digest` seguido de token se
 * consume entero. Un valor que empieza por `[` ya es un marcador y no se vuelve a redactar.
 */
const SENSITIVE_PAIR =
  /(\b[\w-]*(?:password|passwd|pwd|secret|token|key|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:(?:basic|bearer|token|digest)\s+)?(?!\[)[^\s,;&"']+)/gi;

const BEARER_TOKEN = /\bBearer\s+[\w.~+/-]+=*/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const OPENAI_STYLE_KEY = /\bsk-[\w-]{8,}/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_\w{10,})/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
/** Credenciales `usuario:clave@` dentro de una URL. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;
/** Query y fragmento de una URL (donde viajan las firmas y tokens temporales). */
const URL_QUERY_AND_FRAGMENT = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]+)[?#]\S*/gi;

/** Orden de aplicación: el par `Authorization: Bearer x` debe consumirse antes que `Bearer x`. */
const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [PRIVATE_KEY_BLOCK, REDACTED],
  [SENSITIVE_PAIR, `$1${REDACTED}`],
  [BEARER_TOKEN, `Bearer ${REDACTED}`],
  [JWT, REDACTED],
  [OPENAI_STYLE_KEY, REDACTED],
  [GITHUB_TOKEN, REDACTED],
  [AWS_ACCESS_KEY, REDACTED],
  [URL_USERINFO, `$1${REDACTED}@`],
  [URL_QUERY_AND_FRAGMENT, '$1'],
];

/** Tabulador, salto de línea, retorno de carro, tabulador vertical y de página: se convierten en espacio. */
const WHITESPACE_CONTROL_CODES = new Set([9, 10, 11, 12, 13]);

function normalizeControlCharacters(text: string): string {
  let normalized = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (WHITESPACE_CONTROL_CODES.has(code)) {
      normalized += ' ';
    } else if (code < 0x20 || code === 0x7f) {
      // Resto de caracteres de control: se eliminan.
    } else {
      normalized += char;
    }
  }
  return normalized;
}

/**
 * Devuelve el mensaje sin secretos y con como máximo 500 caracteres (puntos de código, no unidades UTF-16).
 * Un mensaje sin secretos, sin caracteres de control y de hasta 500 caracteres vuelve idéntico.
 */
export function sanitizeFailureMessage(message: string): string {
  const redacted = REDACTION_RULES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalizeControlCharacters(message),
  );
  return Array.from(redacted).slice(0, FAILURE_MESSAGE_MAX_LENGTH).join('');
}
