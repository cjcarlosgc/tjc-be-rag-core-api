// WI-CORE-107: escáner pequeño de la firma de una función o método PHP para decidir si tiene cuerpo (D-OE2-5).
// No es un parser: ignora comentarios (`//`, `#`, `/* */`), cadenas ('...', "...") y atributos (`#[...]`), balancea
// los paréntesis de los parámetros y mira si lo primero que sigue al tipo de retorno (nullable, unión, `static`, DNF)
// es `{` (con cuerpo) o `;` (abstracto o de interfaz). Limitación declarada: no interpreta heredocs ni nowdocs.

const IDENTIFIER_START = /[A-Za-z_\\\u0080-￿]/;
const IDENTIFIER_PART = /[\w\\\u0080-￿]/;

/**
 * Tokeniza solo lo significativo: palabras (identificadores con `\`), y signos de puntuación de una carácter. Omite
 * espacios, comentarios, cadenas y atributos `#[...]` (con su contenido). Un atributo se representa por nada: no
 * puede contener la palabra `function` ni un `{`/`;` que confunda la lectura.
 */
export function tokenizePhpSignature(source) {
  const tokens = [];
  const n = source.length;
  let i = 0;

  const skipString = (quote, start) => {
    let j = start + 1;
    while (j < n) {
      if (source[j] === '\\') {
        j += 2;
        continue;
      }
      if (source[j] === quote) return j + 1;
      j += 1;
    }
    return n;
  };

  // Salta un atributo `#[` ... `]` balanceando corchetes; respeta cadenas y comentarios internos.
  const skipAttribute = (start) => {
    let depth = 0;
    let j = start;
    while (j < n) {
      const char = source[j];
      if (char === "'" || char === '"') {
        j = skipString(char, j);
        continue;
      }
      if (char === '/' && source[j + 1] === '*') {
        const end = source.indexOf('*/', j + 2);
        j = end === -1 ? n : end + 2;
        continue;
      }
      if (char === '[') depth += 1;
      if (char === ']') {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
      j += 1;
    }
    return n;
  };

  while (i < n) {
    const char = source[i];
    const next = source[i + 1];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v') {
      i += 1;
    } else if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (char === '#' && next === '[') {
      i = skipAttribute(i + 1);
    } else if (char === '#') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (char === "'" || char === '"') {
      i = skipString(char, i);
      tokens.push({ type: 'string' });
    } else if (IDENTIFIER_START.test(char)) {
      let j = i + 1;
      while (j < n && IDENTIFIER_PART.test(source[j])) j += 1;
      tokens.push({ type: 'word', value: source.slice(i, j) });
      i = j;
    } else {
      tokens.push({ type: 'punct', value: char });
      i += 1;
    }
  }
  return tokens;
}

/**
 * Decide si el primer `function` del contenido (un método o una función libre) tiene cuerpo.
 * Devuelve `{ found: false, hasBody: null }` si no hay ninguna firma. `hasBody` es `true` con `{` y `false` con `;`.
 */
export function scanFunctionSignature(source) {
  const tokens = tokenizePhpSignature(source);
  const keyword = tokens.findIndex((token) => token.type === 'word' && token.value.toLowerCase() === 'function');
  if (keyword === -1) return { found: false, hasBody: null };

  // Primer `(` tras el nombre (el nombre, si lo hay, no contiene paréntesis; un `&` por referencia es opcional).
  let open = keyword + 1;
  while (open < tokens.length && tokens[open].type !== 'punct') open += 1;
  while (open < tokens.length && !(tokens[open].type === 'punct' && tokens[open].value === '(')) {
    if (tokens[open].type === 'punct' && tokens[open].value !== '&') return { found: false, hasBody: null };
    open += 1;
  }
  if (open >= tokens.length) return { found: false, hasBody: null };

  // Cierre del paréntesis de parámetros.
  let depth = 0;
  let close = -1;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (token.value === '(') depth += 1;
    if (token.value === ')') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1) return { found: false, hasBody: null };

  // Tipo de retorno opcional: el primer `{` o `;` fuera de paréntesis decide (DNF `(A&B)|null` no lo rompe).
  depth = 0;
  for (let index = close + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (token.value === '(') depth += 1;
    else if (token.value === ')') depth -= 1;
    else if (depth <= 0 && token.value === '{') return { found: true, hasBody: true };
    else if (depth <= 0 && token.value === ';') return { found: true, hasBody: false };
  }
  return { found: true, hasBody: null };
}

/** `true` si la firma tiene cuerpo, `false` si es abstracta o de interfaz y `null` si no se pudo determinar. */
export function hasBody(source) {
  return scanFunctionSignature(source).hasBody;
}
