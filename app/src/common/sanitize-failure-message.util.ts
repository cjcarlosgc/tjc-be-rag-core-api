/**
 * WI-CORE-007 (HU12/HU17; INTEROP-2.7 §6.16), ampliado en WI-CORE-027 (DEC-EVID-004, IDEA-016): saneado del
 * texto de fallo antes de persistirlo o exponerlo.
 *
 * Orden fijo: normaliza caracteres de control (acotando la entrada a FAILURE_MESSAGE_SCAN_MAX_LENGTH puntos
 * de código antes de cualquier expresión regular), redacta secretos con una lista cerrada de patrones y solo
 * después trunca a 500 caracteres, para que ningún secreto quede cortado a medias. Es una función pura e
 * idempotente: sanear dos veces produce el mismo resultado. La lista de familias es cerrada: lo que no está
 * aquí no se redacta, y cada familia nueva exige su prueba de regresión, de idempotencia y de rendimiento.
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
 * Cabeceras `Cookie:` y `Set-Cookie:`. Tras normalizar no quedan saltos de línea, así que el valor de la
 * cabecera se redacta hasta el final del mensaje (conservador: nunca deja un valor de cookie a medias).
 */
const COOKIE_HEADER = /\b((?:Set-)?Cookie\s*:)[\s\S]*/gi;

/**
 * Pares `CLAVE=valor`, `CLAVE: valor` o JSON `"clave":"valor"` cuya clave contiene un nombre sensible. Conserva
 * la clave y sustituye el valor. El valor puede ser:
 * - una cadena entre comillas dobles o simples, con escapes (`\"`); sin cierre, llega hasta el final;
 * - una lista `[...]`, que se sustituye entera (así cubre `["a","b"]`); sin cierre, llega hasta el final;
 * - un token sin espacios ni delimitadores, opcionalmente precedido por `Basic|Bearer|Token|Digest`.
 * No captura el prefijo de la clave (`DATABASE_` en `DATABASE_PASSWORD=`): la sustitución lo conserva tal cual.
 * Las alternativas empiezan por caracteres distintos o terminan en `$`, así que el coste es lineal.
 * La clave debe ir pegada al separador: `author=` no coincide con `auth`, pero `oauth=` sí (conservador).
 */
const SENSITIVE_PAIR =
  /((?:password|passwd|pwd|secret|token|key|authorization|auth|credentials?|signature|sig)["']?\s*[:=]\s*)(?:"(?:[^"\\]|\\[\s\S]?)*(?:"|$)|'(?:[^'\\]|\\[\s\S]?)*(?:'|$)|\[(?:[^\]"]|"(?:[^"\\]|\\[\s\S]?)*(?:"|$))*\]?|(?:(?:basic|bearer|token|digest)\s+)?[^\s,;&"']+)/gi;

/**
 * Palabra sensible seguida de espacio y de un token que contiene al menos un dígito (`password hunter2`). Sin
 * separador `=` o `:` el criterio exige el dígito para no redactar prosa como `token expired`. El lookahead solo
 * recorre el token que sigue, así que el coste es lineal.
 */
const SENSITIVE_WORD_TOKEN =
  /(?<![\w-])((?:password|passwd|pwd|secret|token|apikey|api_key)[ \t]+)(?=\S*\d)\S{4,}/gi;

const BEARER_TOKEN = /\bBearer\s+[\w.~+/-]+=*/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const OPENAI_STYLE_KEY = /\bsk-[\w-]{8,}/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_\w{10,})/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
/** Tokens de Slack (`xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-`). */
const SLACK_TOKEN = /\bxox[abprs]-[\w-]{8,}/g;
/** Claves de Stripe en modo directo o de prueba (`sk_live_`, `sk_test_`, `rk_live_`). */
const STRIPE_KEY = /\b(?:sk_live_|sk_test_|rk_live_)[A-Za-z0-9]{8,}/g;
/** Claves de API de Google (`AIza` seguido de 30 o más caracteres). */
const GOOGLE_API_KEY = /\bAIza[\w-]{30,}/g;
/** Tokens de npm (`npm_` seguido de 20 o más caracteres alfanuméricos). */
const NPM_TOKEN = /\bnpm_[A-Za-z0-9]{20,}/g;
/**
 * Inicio de un esquema de URL (`https://`). El lookbehind hace que solo se empiece al principio de cada
 * esquema, de modo que el recorrido de un token es lineal.
 */
const URL_SCHEME = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\//i;
/** Ruta de webhook de Slack `/services/T…/B…/…`: se sustituye el secreto y se conserva el prefijo `/services/`. */
const SLACK_WEBHOOK_PATH = /\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g;
/**
 * Segmento de ruta largo que va justo tras `/token/` o `/key/` (16 o más caracteres de token). Rutas normales y
 * cortas (`/key/short`, `/docs/key/x`) no coinciden.
 */
const TOKEN_PATH_SEGMENT = /(\/(?:token|key)\/)[A-Za-z0-9._~+-]{16,}/gi;

/**
 * Orden de aplicación: las URL se procesan antes que las reglas de texto (en `redactUrlToken`), para que
 * `https://u:a=b@host` no deje el nombre de usuario visible. La cabecera Cookie se redacta antes que los pares,
 * y el par `Authorization: Bearer x` debe consumirse antes que `Bearer x`.
 */
const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [PRIVATE_KEY_BLOCK, REDACTED],
  [COOKIE_HEADER, `$1 ${REDACTED}`],
  [SENSITIVE_PAIR, `$1${REDACTED}`],
  [SENSITIVE_WORD_TOKEN, `$1${REDACTED}`],
  [BEARER_TOKEN, `Bearer ${REDACTED}`],
  [JWT, REDACTED],
  [OPENAI_STYLE_KEY, REDACTED],
  [GITHUB_TOKEN, REDACTED],
  [SLACK_TOKEN, REDACTED],
  [STRIPE_KEY, REDACTED],
  [GOOGLE_API_KEY, REDACTED],
  [NPM_TOKEN, REDACTED],
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
 * Credenciales `usuario:clave@`, query o fragmento de una URL y secretos en su ruta, dentro de un token sin
 * espacios. Quita todo el authority hasta el último `@` del token (la clave puede contener `/` o `@`), después
 * la query y el fragmento, y por último las rutas de webhook de Slack y los segmentos `/token/` o `/key/`.
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
  rest = rest.replace(SLACK_WEBHOOK_PATH, `/services/${REDACTED}`).replace(TOKEN_PATH_SEGMENT, `$1${REDACTED}`);
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
