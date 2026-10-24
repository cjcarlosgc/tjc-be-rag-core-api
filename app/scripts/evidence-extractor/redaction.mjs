// WI-CORE-094: copia local de `redactSecretsInText` de `src/common/sanitize-failure-message.util.ts` (WI-CORE-007 /
// WI-CORE-027 / WI-CORE-060). El script es Node puro y no importa TypeScript del producto; por eso las reglas se
// replican aquí, en el mismo orden y con las mismas expresiones. La prueba `redaction.spec.ts` compara ambas
// implementaciones sobre un corpus y falla si divergen.
//
// Uso: SOLO sobre la COPIA redactada de la evidencia del Sandbox (sandbox-evidence.json). NUNCA sobre el contenido
// de las pruebas generadas: la utilidad mutila texto de código (cookies, pares clave=valor, URLs) y el hash del
// test debe verificarse sobre los bytes originales de la base de datos.

export const REDACTED = '[REDACTED]';

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/gi;
const COOKIE_HEADER = /\b((?:Set-)?Cookie\s*:)[\s\S]*/gi;
const SENSITIVE_PAIR =
  /((?:password|passwd|pwd|secret|token|key|authorization|auth|credentials?|signature|sig)["']?\s*[:=]\s*)(?:"(?:[^"\\]|\\[\s\S]?)*(?:"|$)|'(?:[^'\\]|\\[\s\S]?)*(?:'|$)|\[(?:[^\]"]|"(?:[^"\\]|\\[\s\S]?)*(?:"|$))*\]?|(?:(?:basic|bearer|token|digest)\s+)?[^\s,;&"']+)/gi;
const SENSITIVE_WORD_TOKEN =
  /(?<![\w-])((?:password|passwd|pwd|secret|token|apikey|api_key)[ \t]+)(?=\S*\d)\S{4,}/gi;
const BEARER_TOKEN = /\bBearer\s+[\w.~+/-]+=*/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const SK_PREFIXED_KEY = /\bsk-[\w-]{8,}/g;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_\w{10,})/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const SLACK_TOKEN = /\bxox[abprs]-[\w-]{8,}/g;
const STRIPE_KEY = /\b(?:sk_live_|sk_test_|rk_live_)[A-Za-z0-9]{8,}/g;
const GOOGLE_API_KEY = /\bAIza[\w-]{30,}/g;
const NPM_TOKEN = /\bnpm_[A-Za-z0-9]{20,}/g;
const URL_SCHEME = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\//i;
const SLACK_WEBHOOK_PATH = /\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g;
const TOKEN_PATH_SEGMENT = /(\/(?:token|key)\/)[A-Za-z0-9._~+-]{16,}/gi;

const REDACTION_RULES = [
  [PRIVATE_KEY_BLOCK, REDACTED],
  [COOKIE_HEADER, `$1 ${REDACTED}`],
  [SENSITIVE_PAIR, `$1${REDACTED}`],
  [SENSITIVE_WORD_TOKEN, `$1${REDACTED}`],
  [BEARER_TOKEN, `Bearer ${REDACTED}`],
  [JWT, REDACTED],
  [SK_PREFIXED_KEY, REDACTED],
  [GITHUB_TOKEN, REDACTED],
  [SLACK_TOKEN, REDACTED],
  [STRIPE_KEY, REDACTED],
  [GOOGLE_API_KEY, REDACTED],
  [NPM_TOKEN, REDACTED],
  [AWS_ACCESS_KEY, REDACTED],
];

function redactUrlToken(token) {
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
 * Redacta secretos en un texto libre sin normalizar saltos de línea ni truncar (igual que el producto).
 * Idempotente. Devuelve el texto de entrada si no hay nada que redactar.
 */
export function redactSecretsInText(text) {
  const scanned = String(text ?? '').replace(/\S+/g, redactUrlToken);
  return REDACTION_RULES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), scanned);
}
