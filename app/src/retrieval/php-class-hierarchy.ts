import {
  findAttributeEnd,
  findStringEnd,
  MAX_PHP_ABSTRACT_OBLIGATIONS,
  readParameterList,
  renderPhpAbstractObligationLines,
  stripLeadingPhpNoise,
} from './php-dependency-context.js';

/**
 * WI-CORE-106: lectura pura de jerarquías de clases PHP para listar los métodos abstractos que una subclase
 * concreta debe implementar. Ninguna función lanza: ante cualquier ambigüedad devuelven null o una lista vacía
 * (nunca se afirma algo que el texto no demuestra).
 */

export type PhpTypeKind = 'class' | 'interface' | 'trait' | 'enum';

export interface PhpTypeHeader {
  kind: PhpTypeKind;
  isAbstract: boolean;
  /** Nombres tal como están escritos (con `\` inicial o cualificados); la resolución a FQCN se hace fuera. */
  extendsNames: string[];
  implementsNames: string[];
}

export interface PhpAbstractMethod {
  name: string;
  /** `nombre(params): retorno` con espacios normalizados (sin tipo de retorno si no lo declara). */
  signature: string;
}

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';
const TYPE_NAME_PATTERN = new RegExp(`^\\\\?${IDENTIFIER}(?:\\\\${IDENTIFIER})*$`);

/**
 * Misma longitud que `content`: comentarios, atributos `#[...]` y cadenas quedan en blanco (se conservan los
 * saltos de línea). Permite buscar palabras clave sin confundirlas con texto de comentarios o cadenas.
 */
function maskPhpNoise(content: string): string {
  const out: string[] = [];
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) out.push(content[index] === '\n' ? '\n' : ' ');
  };
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if ((char === '/' && next === '/') || (char === '#' && next !== '[')) {
      const newline = content.indexOf('\n', index);
      const end = newline < 0 ? content.length : newline;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const close = content.indexOf('*/', index + 2);
      const end = close < 0 ? content.length : close + 2;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === '#' && next === '[') {
      const close = findAttributeEnd(content.slice(index));
      const end = close < 0 ? content.length : index + close + 1;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === "'" || char === '"') {
      const close = findStringEnd(content, index);
      const end = close < 0 ? content.length : close + 1;
      blank(index, end);
      index = end;
      continue;
    }
    out.push(char);
    index += 1;
  }
  return out.join('');
}

function parseNameList(text: string | undefined): string[] | null {
  if (text === undefined) return [];
  const names = text.split(',').map((name) => name.trim());
  if (names.some((name) => !TYPE_NAME_PATTERN.test(name))) return null;
  return names;
}

/**
 * Cabecera de la PRIMERA declaración de tipo del contenido, ignorando comentarios, docblocks, atributos,
 * `<?php`, `declare`, `namespace` y `use`, y `final`/`readonly`/`abstract` en cualquier orden. Null si no es
 * legible (otra sentencia primero, cabecera sin `{`, nombres que no son nombres de tipo, `extends` múltiple en una
 * clase, `implements` en una interfaz).
 */
export function parsePhpTypeHeader(content: string): PhpTypeHeader | null {
  try {
    if (typeof content !== 'string') return null;
    let rest = maskPhpNoise(content);
    for (let guard = 0; guard < 1_000; guard += 1) {
      rest = rest.replace(/^\s+/, '');
      const skip =
        /^<\?php\b/i.exec(rest) ??
        /^declare\s*\([^)]*\)\s*;/i.exec(rest) ??
        /^namespace\s+[^;{]*;/i.exec(rest) ??
        /^use\s+[^;]*;/i.exec(rest);
      if (!skip) break;
      rest = rest.slice(skip[0].length);
    }
    const declaration = new RegExp(
      `^((?:(?:final|readonly|abstract)\\s+)*)(class|interface|trait|enum)\\s+${IDENTIFIER}`,
      'i',
    ).exec(rest);
    if (!declaration) return null;
    const kind = declaration[2].toLowerCase() as PhpTypeKind;
    const modifiers = declaration[1].toLowerCase().split(/\s+/).filter((word) => word !== '');
    const afterName = rest.slice(declaration[0].length);
    const brace = afterName.indexOf('{');
    if (brace < 0) return null;
    let headerText = afterName.slice(0, brace);
    if (kind === 'enum') headerText = headerText.replace(/^\s*:\s*[A-Za-z_][A-Za-z0-9_]*/, '');
    const clauses = /^\s*(?:extends\s+(.+?))?\s*(?:\bimplements\s+(.+?))?\s*$/is.exec(headerText);
    if (!clauses) return null;
    const extendsNames = parseNameList(clauses[1]);
    const implementsNames = parseNameList(clauses[2]);
    if (extendsNames === null || implementsNames === null) return null;
    if (kind === 'class' && extendsNames.length > 1) return null;
    if (kind === 'interface' && implementsNames.length > 0) return null;
    if ((kind === 'trait' || kind === 'enum') && extendsNames.length > 0) return null;
    return { kind, isAbstract: kind === 'class' && modifiers.includes('abstract'), extendsNames, implementsNames };
  } catch {
    return null;
  }
}

function normalizeReturnType(raw: string | undefined): string {
  return raw === undefined ? '' : raw.replace(/\s+/g, ' ').trim();
}

function buildSignature(name: string, parameters: string, returnType: string): string {
  return `${name}(${parameters})${returnType !== '' ? `: ${returnType}` : ''}`;
}

/**
 * Firmas de los métodos de un chunk INTERFACE (partes concatenadas si se pasan juntas): cada
 * `[public] [static] function nombre(params)[: retorno];` pasa a `nombre(params): retorno`. Lo que tenga cuerpo
 * o no se pueda leer completo se omite.
 */
export function extractPhpInterfaceMethodSignatures(content: string): string[] {
  try {
    if (typeof content !== 'string') return [];
    const masked = maskPhpNoise(content);
    const pattern = new RegExp(`\\bfunction\\s+&?\\s*(${IDENTIFIER})\\s*\\(`, 'gi');
    const signatures: string[] = [];
    for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
      const parameters = readParameterList(content, match.index + match[0].length - 1);
      if (parameters === null) continue;
      const tail = /^\s*(?::\s*([^;{]*?))?\s*;/.exec(masked.slice(parameters.end + 1));
      if (!tail) continue;
      signatures.push(buildSignature(match[1], parameters.text, normalizeReturnType(tail[1])));
      pattern.lastIndex = parameters.end + 1;
    }
    return signatures;
  } catch {
    return [];
  }
}

const METHOD_DECLARATION = new RegExp(
  `^((?:(?:public|protected|private|static|final|abstract)\\s+)*)function\\s+&?\\s*(${IDENTIFIER})\\s*\\(`,
  'i',
);

/**
 * Chunk METHOD que declara `abstract` (visibilidad `public` o `protected`, o ninguna) y termina en `;` sin
 * cuerpo. Cualquier otra cosa (con cuerpo, privado, no abstracto, ilegible) da null.
 */
export function extractPhpAbstractMethod(content: string): PhpAbstractMethod | null {
  try {
    if (typeof content !== 'string') return null;
    const declaration = stripLeadingPhpNoise(content);
    const match = METHOD_DECLARATION.exec(declaration);
    if (!match) return null;
    const modifiers = match[1].toLowerCase().split(/\s+/).filter((word) => word !== '');
    if (!modifiers.includes('abstract') || modifiers.includes('private') || modifiers.includes('final')) return null;
    const parameters = readParameterList(declaration, match[0].length - 1);
    if (parameters === null) return null;
    const tail = /^\s*(?::\s*([^;{]*?))?\s*;/.exec(maskPhpNoise(declaration.slice(parameters.end + 1)));
    if (!tail) return null;
    return { name: match[2], signature: buildSignature(match[2], parameters.text, normalizeReturnType(tail[1])) };
  } catch {
    return null;
  }
}

/**
 * Nombre de un método que cuenta como implementado: chunk METHOD/CONSTRUCTOR no abstracto y de visibilidad
 * `public` o `protected` (o sin visibilidad, que es `public`). Un método `private` no implementa un abstracto y da
 * null, igual que lo no legible.
 */
export function extractPhpImplementedMethodName(content: string): string | null {
  try {
    if (typeof content !== 'string') return null;
    const match = METHOD_DECLARATION.exec(stripLeadingPhpNoise(content));
    if (!match) return null;
    const modifiers = match[1].toLowerCase().split(/\s+/).filter((word) => word !== '');
    if (modifiers.includes('private') || modifiers.includes('abstract')) return null;
    return match[2];
  } catch {
    return null;
  }
}

/**
 * true si el cuerpo de la clase usa traits: una sentencia `use Nombre[, Otro];` o `use Nombre { … }` al nivel del
 * cuerpo (profundidad 1 de llaves, tras la llave de apertura de la declaración). No cuentan los `use` de namespace
 * anteriores a la clase, los `use (...)` de closures dentro de métodos ni los de comentarios, cadenas o atributos.
 * Cabecera o cuerpo ilegible: true (incierto). Se espera la primera parte del chunk de la clase.
 */
export function phpClassUsesTraits(content: string): boolean {
  try {
    if (typeof content !== 'string') return true;
    if (parsePhpTypeHeader(content) === null) return true;
    let rest = maskPhpNoise(content);
    for (let guard = 0; guard < 1_000; guard += 1) {
      rest = rest.replace(/^\s+/, '');
      const skip =
        /^<\?php\b/i.exec(rest) ??
        /^declare\s*\([^)]*\)\s*;/i.exec(rest) ??
        /^namespace\s+[^;{]*;/i.exec(rest) ??
        /^use\s+[^;]*;/i.exec(rest);
      if (!skip) break;
      rest = rest.slice(skip[0].length);
    }
    const open = rest.indexOf('{');
    if (open < 0) return true;
    const body = rest.slice(open + 1);
    let depth = 0;
    let statementStart = true;
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      if (/\s/.test(char)) continue;
      if (statementStart && depth === 0) {
        if (/^use\s+[A-Za-z_\\]/i.test(body.slice(index, index + 200))) return true;
        statementStart = false;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        if (depth === 0) return false;
        depth -= 1;
        if (depth === 0) statementStart = true;
      } else if (char === ';' && depth === 0) statementStart = true;
    }
    return false;
  } catch {
    return true;
  }
}

/** Nombre del método que declara un chunk METHOD/CONSTRUCTOR (ignora docblocks, atributos y modificadores). */
export function extractPhpMethodName(content: string): string | null {
  try {
    if (typeof content !== 'string') return null;
    const match = METHOD_DECLARATION.exec(stripLeadingPhpNoise(content));
    return match ? match[2] : null;
  } catch {
    return null;
  }
}

export interface DeclaringTypeHierarchyInfo {
  /** Nombre corto del tipo declarante. */
  name: string;
  isAbstract: boolean;
  /** Métodos que el tipo implementa con cuerpo. */
  implementedMethodNames: string[];
  abstractMethods: PhpAbstractMethod[];
}

export interface AncestorHierarchyInfo {
  /** Nombre corto del ancestro. */
  name: string;
  kind: 'interface' | 'class';
  /** Distancia al declarante en la jerarquía (1 a 3). */
  level: number;
  abstractMethods: PhpAbstractMethod[];
  implementedMethodNames: string[];
}

export interface AbstractObligation {
  owner: string;
  signature: string;
}

export interface ComputeAbstractObligationsInput {
  declaring: DeclaringTypeHierarchyInfo;
  ancestors: readonly AncestorHierarchyInfo[];
}

export interface ComputedAbstractObligations {
  methods: AbstractObligation[];
  /**
   * true solo si había más de `MAX_PHP_ABSTRACT_OBLIGATIONS` (12) y se recortó la lista. Es informativo: el
   * máximo de 12 firmas NO activa el `truncated` de la sección, que solo refleja el recorte por tokens.
   */
  truncatedByLimit: boolean;
}

interface Candidate {
  owner: string;
  name: string;
  signature: string;
  level: number;
}

/**
 * Abstractos propios del declarante y de sus ancestros, menos los que implementa con cuerpo alguna clase de la
 * cadena (declarante o ancestro, abstracta o concreta) que esté más cerca del declarante que cualquier
 * redeclaración `abstract` de ese método (una redeclaración abstracta más cercana lo mantiene abstracto).
 * Sin duplicados por nombre de método (los nombres de método no distinguen mayúsculas; gana el nivel más
 * cercano), orden estable (nivel, luego nombre) y máximo 12. Solo para un declarante abstracto: si no lo es,
 * devuelve vacío.
 */
export function computeInheritedAbstractObligations(input: ComputeAbstractObligationsInput): ComputedAbstractObligations {
  const none: ComputedAbstractObligations = { methods: [], truncatedByLimit: false };
  try {
    const { declaring, ancestors } = input;
    if (!declaring.isAbstract) return none;

    const implementedAt = new Map<string, number>();
    const abstractClassAt = new Map<string, number>();
    const noteMin = (map: Map<string, number>, name: string, level: number): void => {
      const key = name.toLowerCase();
      const current = map.get(key);
      if (current === undefined || level < current) map.set(key, level);
    };
    for (const name of declaring.implementedMethodNames) noteMin(implementedAt, name, 0);
    for (const method of declaring.abstractMethods) noteMin(abstractClassAt, method.name, 0);
    for (const ancestor of ancestors) {
      if (ancestor.kind !== 'class') continue;
      for (const name of ancestor.implementedMethodNames) noteMin(implementedAt, name, ancestor.level);
      for (const method of ancestor.abstractMethods) noteMin(abstractClassAt, method.name, ancestor.level);
    }

    const candidates: Candidate[] = [
      ...declaring.abstractMethods.map((method) => ({ owner: declaring.name, ...method, level: 0 })),
      ...ancestors.flatMap((ancestor) =>
        ancestor.abstractMethods.map((method) => ({ owner: ancestor.name, ...method, level: ancestor.level })),
      ),
    ];

    const byName = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const key = candidate.name.toLowerCase();
      const implementedLevel = implementedAt.get(key);
      const redeclaredLevel = abstractClassAt.get(key);
      const isImplemented =
        implementedLevel !== undefined && (redeclaredLevel === undefined || implementedLevel < redeclaredLevel);
      if (isImplemented) continue;
      const current = byName.get(key);
      if (current === undefined || candidate.level < current.level) byName.set(key, candidate);
    }

    const sorted = [...byName.values()].sort((left, right) => {
      if (left.level !== right.level) return left.level - right.level;
      const leftName = left.name.toLowerCase();
      const rightName = right.name.toLowerCase();
      return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
    });
    return {
      methods: sorted
        .slice(0, MAX_PHP_ABSTRACT_OBLIGATIONS)
        .map((candidate) => ({ owner: candidate.owner, signature: candidate.signature })),
      truncatedByLimit: sorted.length > MAX_PHP_ABSTRACT_OBLIGATIONS,
    };
  } catch {
    return none;
  }
}

/** Bloque del prompt; vacío si no hay métodos. Usa `Owner::firma` con el nombre corto del tipo; `uncertain` añade el aviso al encabezado. */
export function renderPhpAbstractObligations(methods: readonly AbstractObligation[], uncertain = false): string {
  return renderPhpAbstractObligationLines(methods.map((method) => `${method.owner}::${method.signature}`), uncertain);
}
