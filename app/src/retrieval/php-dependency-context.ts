import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';

/**
 * Contexto determinista de dependencias PHP (WI-CORE-057, INTEROP-2.14). Lista los FQCN de los tipos
 * que aparecen en el constructor de la clase declarante y en la firma del método objetivo, solo cuando
 * se pueden verificar. No participa en el ranking ni en `contextTokens`.
 */

export type PhpDependencyOrigin = 'CONSTRUCTOR' | 'METHOD_SIGNATURE';
export type PhpDependencyResolvedBy = 'LITERAL' | 'IMPORT' | 'SAME_NAMESPACE';

export interface PhpDependencyEntry {
  typeName: string;
  fqcn: string;
  origin: PhpDependencyOrigin;
  resolvedBy: PhpDependencyResolvedBy;
  /** WI-CORE-058 (INTEROP-2.15): presente solo cuando es true; el tipo es final o enum según el índice. */
  final?: true;
  /** WI-CORE-068: interno, no va a la traza; presente solo si el índice declara el tipo como ENUM (con `final: true`). */
  enum?: true;
  /** WI-CORE-065: firma del constructor `(…)` sin cuerpo; presente solo si se determinó sin ambigüedad. */
  signature?: string;
  /** WI-CORE-066: typeName de la dependencia directa de origen; presente solo en profundidad 2. Interno, no va a la traza. */
  via?: string;
  /**
   * WI-CORE-104 (R2a): interno, no va a la traza. Presente solo en dependencias directas cuyo constructor el
   * índice declara `private` o `protected`; entonces `signature` no se imprime ni se guarda.
   */
  constructorVisibility?: 'private' | 'protected';
  /** WI-CORE-104 (R2a): interno; fábricas públicas estáticas (`nombre(params): retorno`, máximo 4). Solo con `constructorVisibility`. */
  factories?: string[];
}

/** WI-CORE-104 (R2b): entrada del glosario de FQCN del contexto. */
export interface PhpFqcnGlossaryEntry {
  typeName: string;
  fqcn: string;
}

export type PhpConstructorVisibility = 'public' | 'protected' | 'private';

/** WI-CORE-104: sección completa (dependencias + glosario). Es lo que consume el prompt y lo que se traza (sin `text`). */
export interface PhpDependencySection {
  /** Solo dependencias directas: es lo que se traza (sin cambio de forma). */
  entries: PhpDependencyEntry[];
  /** WI-CORE-066: profundidad 2, interna; no va a la traza. */
  transitiveEntries: PhpDependencyEntry[];
  unresolvedCount: number;
  truncated: boolean;
  tokenCount: number;
  text: string;
}

/** WI-CORE-066: FQCN resuelto desde el constructor de una dependencia directa (profundidad 2). */
export interface PhpConstructorTypeReference {
  typeName: string;
  fqcn: string;
  resolvedBy: PhpDependencyResolvedBy;
}

export interface PhpDependencySourceChunk {
  content: string;
  importsUsed: string[];
}

export interface ResolvePhpDependenciesInput {
  /** FQCN de la clase declarante, sin barra inicial. */
  declaringClass: string;
  classImports: string[];
  constructorChunk: PhpDependencySourceChunk | null;
  methodChunk: PhpDependencySourceChunk;
  /** FQCN de los tipos CLASS/INTERFACE/TRAIT/ENUM PHP de la versión, sin barra inicial. */
  knownTypes: ReadonlySet<string>;
  /** WI-CORE-058: FQCN determinados como final (o enum) desde el índice; el resolutor no consulta repositorios. */
  finalTypes?: ReadonlySet<string>;
  /** WI-CORE-068: FQCN declarados como ENUM en el índice (subconjunto de finalTypes); el resolutor no consulta repositorios. */
  enumTypes?: ReadonlySet<string>;
}

export interface ResolvePhpDependenciesResult {
  entries: PhpDependencyEntry[];
  unresolvedCount: number;
  truncated: boolean;
}

export interface CappedPhpDependencies {
  /** Directas y de profundidad 2 (`via` definido) que sobreviven al tope, en su orden. */
  entries: PhpDependencyEntry[];
  truncated: boolean;
  tokenCount: number;
}

export const MAX_PHP_DEPENDENCY_ENTRIES = 20;
/** WI-CORE-104: tope de TODA la sección (dependencias, constructor no público/fábricas y glosario). Era 300. */
export const MAX_PHP_DEPENDENCY_TOKENS = 500;
export const MAX_PHP_FQCN_GLOSSARY_ENTRIES = 30;
export const MAX_PHP_FACTORIES_PER_CLASS = 4;

const SECTION_HEADER =
  'Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`):';

const FINAL_MARK = ' — final: no se puede mockear; usa una instancia real con new';

// WI-CORE-104: con constructor no público la marca de final no manda a usar `new`.
const FINAL_MARK_WITHOUT_NEW = ' — final: no se puede mockear';

const GLOSSARY_HEADER = 'Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:';

const ENUM_MARK = ' — enum: no se puede mockear ni instanciar con new; usa un caso (Enum::Caso)';

const SCALAR_OR_PSEUDO_TYPES = new Set([
  'int', 'float', 'string', 'bool', 'array', 'callable', 'iterable', 'mixed', 'object', 'void', 'never',
  'null', 'false', 'true', 'self', 'static', 'parent',
]);

const GLOBAL_CLASSES_WITHOUT_IMPORT = new Set(
  [
    'Closure', 'Stringable', 'Countable', 'ArrayAccess', 'Traversable', 'Iterator', 'IteratorAggregate',
    'JsonSerializable', 'DateTime', 'DateTimeImmutable', 'DateTimeInterface', 'DateInterval', 'Throwable',
    'Exception', 'InvalidArgumentException', 'RuntimeException', 'LogicException', 'DomainException',
    'TypeError', 'UnexpectedValueException',
  ].map((name) => name.toLowerCase()),
);

interface ResolutionContext {
  declaringNamespacePrefix: string;
  importByShortName: Map<string, string>;
  knownTypes: ReadonlySet<string>;
}

type NameResolution =
  | { kind: 'skip' }
  | { kind: 'unresolved' }
  | { kind: 'resolved'; fqcn: string; resolvedBy: PhpDependencyResolvedBy };

/** Resuelve los tipos de constructor y firma del método a FQCN verificables; no inventa nombres. */
export function resolvePhpDependencies(input: ResolvePhpDependenciesInput): ResolvePhpDependenciesResult {
  const context = buildResolutionContext(input);
  const candidates = [
    ...extractTypeNames(input.constructorChunk?.content ?? null, 'CONSTRUCTOR'),
    ...extractTypeNames(input.methodChunk.content, 'METHOD_SIGNATURE'),
  ];

  const entriesByFqcn = new Map<string, PhpDependencyEntry>();
  const unresolvedNames = new Set<string>();

  for (const candidate of candidates) {
    const resolution = resolveName(candidate.rawName, context);
    if (resolution.kind === 'skip') continue;
    if (resolution.kind === 'unresolved') {
      unresolvedNames.add(candidate.shortName);
      continue;
    }
    if (entriesByFqcn.has(resolution.fqcn)) continue;
    entriesByFqcn.set(resolution.fqcn, {
      typeName: candidate.shortName,
      fqcn: resolution.fqcn,
      origin: candidate.origin,
      resolvedBy: resolution.resolvedBy,
      ...(input.finalTypes?.has(resolution.fqcn) ? { final: true as const } : {}),
      ...(input.enumTypes?.has(resolution.fqcn) ? { enum: true as const } : {}),
    });
  }

  const allEntries = [...entriesByFqcn.values()];
  const truncated = allEntries.length > MAX_PHP_DEPENDENCY_ENTRIES;
  return {
    entries: allEntries.slice(0, MAX_PHP_DEPENDENCY_ENTRIES),
    unresolvedCount: unresolvedNames.size,
    truncated,
  };
}

/** Texto de la sección de dependencias; vacío si no hay entradas. */
export function renderPhpDependencySection(entries: readonly PhpDependencyEntry[]): string {
  if (entries.length === 0) return '';
  const direct = entries.filter((entry) => entry.via === undefined);
  const transitive = entries.filter((entry) => entry.via !== undefined);
  const renderLine = (entry: PhpDependencyEntry): string => {
    // WI-CORE-104 (R2a): constructor no público; el enum conserva su marca y nunca lleva este aviso.
    const visibility = entry.enum === true ? undefined : entry.constructorVisibility;
    const finalMark =
      entry.enum === true ? ENUM_MARK : entry.final === true ? (visibility !== undefined ? FINAL_MARK_WITHOUT_NEW : FINAL_MARK) : '';
    let constructorMark = '';
    if (visibility !== undefined) {
      const factories = entry.factories ?? [];
      constructorMark =
        ` — constructor ${visibility === 'private' ? 'privado' : 'protegido'}: no uses new` +
        (factories.length > 0 ? `; fábricas públicas: ${factories.join(', ')}` : '');
    } else if (entry.signature !== undefined) {
      constructorMark = ` — constructor${entry.signature}`;
    }
    return (
      `- ${entry.typeName} → ${entry.fqcn} (${
        entry.via !== undefined
          ? `vía ${entry.via}`
          : entry.origin === 'CONSTRUCTOR' ? 'constructor' : 'firma del método'
      })` +
      finalMark +
      constructorMark
    );
  };
  return [SECTION_HEADER, ...direct.map(renderLine), ...transitive.map(renderLine)].join('\n');
}

/** WI-CORE-104 (R2b): bloque del glosario; vacío si no hay entradas. */
export function renderPhpFqcnGlossary(glossary: readonly PhpFqcnGlossaryEntry[]): string {
  if (glossary.length === 0) return '';
  return [GLOSSARY_HEADER, ...glossary.map((entry) => `- ${entry.typeName} → ${entry.fqcn}`)].join('\n');
}

function renderFullSection(entries: readonly PhpDependencyEntry[], glossary: readonly PhpFqcnGlossaryEntry[]): string {
  return [renderPhpDependencySection(entries), renderPhpFqcnGlossary(glossary)].filter((part) => part !== '').join('\n\n');
}

/**
 * WI-CORE-066: FQCN de los tipos del constructor de una dependencia directa, con las mismas reglas que
 * `resolvePhpDependencies` (literal, IMPORT, SAME_NAMESPACE solo si está en `knownTypes`). Sin inventar
 * nombres, sin duplicados. Nunca lanza.
 */
export function resolvePhpConstructorTypes(input: {
  declaringClass: string;
  content: string;
  importsUsed: readonly string[];
  knownTypes: ReadonlySet<string>;
}): PhpConstructorTypeReference[] {
  try {
    const context = buildContextFromImports(input.declaringClass, input.importsUsed, input.knownTypes);
    const seen = new Map<string, PhpConstructorTypeReference>();
    for (const candidate of extractTypeNames(input.content, 'CONSTRUCTOR')) {
      const resolution = resolveName(candidate.rawName, context);
      if (resolution.kind !== 'resolved' || seen.has(resolution.fqcn)) continue;
      seen.set(resolution.fqcn, {
        typeName: candidate.shortName,
        fqcn: resolution.fqcn,
        resolvedBy: resolution.resolvedBy,
      });
    }
    return [...seen.values()];
  } catch {
    return [];
  }
}

/**
 * WI-CORE-058 (INTEROP-2.15): true solo si la declaración es un enum (`symbolKind` ENUM) o si, tras
 * espacios, comentarios y atributos `#[...]`, empieza con modificadores que incluyen `final` y luego
 * `class` (`final class`, `final readonly class`, `readonly final class`). `abstract`, `readonly` sin
 * `final`, `class`, `interface` y `trait` dan false. Nunca lanza.
 */
export function isFinalPhpDeclaration(content: string, symbolKind: string): boolean {
  try {
    if (symbolKind === 'ENUM') return true;
    if (typeof content !== 'string') return false;
    const declaration = stripLeadingPhpNoise(content);
    const match = /^((?:(?:final|readonly|abstract)\s+)+)class\s/i.exec(declaration);
    if (!match) return false;
    const modifiers = match[1].toLowerCase().split(/\s+/).filter((word) => word !== '');
    return modifiers.includes('final') && !modifiers.includes('abstract');
  } catch {
    return false;
  }
}

// Quita espacios, comentarios de línea (// y # sin [), de bloque y docblocks, y atributos #[...] iniciales.
function stripLeadingPhpNoise(content: string): string {
  let rest = content;
  for (let guard = 0; guard < 10_000; guard += 1) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('//') || (rest.startsWith('#') && !rest.startsWith('#['))) {
      const newline = rest.indexOf('\n');
      if (newline < 0) return '';
      rest = rest.slice(newline + 1);
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      if (end < 0) return '';
      rest = rest.slice(end + 2);
      continue;
    }
    if (rest.startsWith('#[')) {
      const end = findAttributeEnd(rest);
      if (end < 0) return '';
      rest = rest.slice(end + 1);
      continue;
    }
    return rest;
  }
  return '';
}

/** Índice del `]` que cierra el `#[` inicial, con corchetes anidados y cadenas entre comillas. */
function findAttributeEnd(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Tokens de la sección con el mismo tokenizador que los chunks (`cl100k_base`). */
export function countPhpDependencyTokens(text: string): number {
  if (text === '') return 0;
  return countTokens(text);
}

/**
 * WI-CORE-065: firma del constructor (`__construct(...)`) con modificadores promovidos, tipos, nombres y
 * valores por defecto; sin atributos, comentarios, cuerpo ni tipo de retorno. Espacios normalizados.
 * Devuelve null si no hay constructor o no es legible. Nunca lanza.
 */
export function extractPhpConstructorSignature(content: string): string | null {
  try {
    if (typeof content !== 'string') return null;
    const match = CONSTRUCTOR_PATTERN.exec(content);
    if (!match) return null;
    const parameters = readParameterList(content, match.index + match[0].length - 1);
    return parameters === null ? null : `(${parameters.text})`;
  } catch {
    return null;
  }
}

const CONSTRUCTOR_PATTERN = /\bfunction\s+__construct\s*\(/i;

const PHP_IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * WI-CORE-104 (R2a): visibilidad declarada de `__construct`, ignorando docblocks, comentarios, atributos y
 * `final`. Sin modificador de visibilidad es `public` (PHP). `null` si el contenido no empieza en una
 * declaración de método legible o si declara dos visibilidades distintas. Nunca lanza.
 */
export function extractPhpConstructorVisibility(content: string): PhpConstructorVisibility | null {
  try {
    if (typeof content !== 'string') return null;
    const declaration = stripLeadingPhpNoise(content);
    const match = new RegExp(
      `^((?:(?:public|protected|private|final|abstract|static)\\s+)*)function\\s+__construct\\s*\\(`,
      'i',
    ).exec(declaration);
    if (!match) return null;
    const visibilities = new Set(
      match[1]
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word === 'public' || word === 'protected' || word === 'private'),
    );
    if (visibilities.size > 1) return null;
    const [visibility] = [...visibilities];
    return (visibility as PhpConstructorVisibility | undefined) ?? 'public';
  } catch {
    return null;
  }
}

/**
 * WI-CORE-104 (R2a): si el chunk de un método de `className` (FQCN) es `public static function nombre(...)`
 * con tipo de retorno `static`, `self`, el nombre corto de la clase o su FQCN (con o sin `?`), devuelve
 * `[ 'nombre(params): retorno' ]` con espacios normalizados; en cualquier otro caso (no estático, no público,
 * abstracto, método mágico `__*`, retorno de otro tipo o ausente, unión de tipos, ilegible) devuelve `[]`. Nunca lanza.
 */
export function extractPhpPublicStaticFactories(content: string, className: string): string[] {
  try {
    if (typeof content !== 'string' || typeof className !== 'string') return [];
    const declaration = stripLeadingPhpNoise(content);
    const match = new RegExp(
      `^((?:(?:public|protected|private|final|abstract|static)\\s+)+)function\\s+(${PHP_IDENTIFIER})\\s*\\(`,
      'i',
    ).exec(declaration);
    if (!match) return [];
    const modifiers = match[1].toLowerCase().split(/\s+/).filter((word) => word !== '');
    if (!modifiers.includes('public') || !modifiers.includes('static') || modifiers.includes('abstract')) return [];
    const name = match[2];
    if (name.startsWith('__')) return [];
    const parameters = readParameterList(declaration, match[0].length - 1);
    if (parameters === null) return [];
    const returnMatch = new RegExp(
      `^\\s*:\\s*(\\??)\\s*(\\\\?${PHP_IDENTIFIER}(?:\\\\${PHP_IDENTIFIER})*)\\s*(?=[{;]|$)`,
    ).exec(declaration.slice(parameters.end + 1));
    if (!returnMatch) return [];
    const nullable = returnMatch[1];
    const returnType = returnMatch[2];
    const normalizedClass = className.replace(/^\\/, '');
    const shortName = normalizedClass.slice(normalizedClass.lastIndexOf('\\') + 1);
    const lowered = returnType.toLowerCase();
    const isOwnType =
      lowered === 'static' || lowered === 'self' || returnType === shortName || returnType.replace(/^\\/, '') === normalizedClass;
    if (!isOwnType) return [];
    return [`${name}(${parameters.text}): ${nullable}${returnType}`];
  } catch {
    return [];
  }
}

/**
 * WI-CORE-104 (R2b): glosario `Nombre → FQCN` de los imports usados en el contexto. Une los grupos en orden
 * (el primero es el del target), quita el `\` inicial, descarta `excludeFqcns`, duplicados por FQCN y los FQCN de
 * un solo segmento (clases globales) y se detiene en `maxEntries` (30). El `typeName` es el último segmento. No inventa nombres: solo entran valores
 * con forma de FQCN. El parser PHP no incluye `use function` ni `use const` en `importsUsed`
 * (`parseUseDeclaration` los excluye), así que no llegan aquí. Nunca lanza.
 */
export function buildPhpFqcnGlossary(input: {
  importGroups: readonly (readonly string[])[];
  excludeFqcns: ReadonlySet<string>;
  maxEntries?: number;
}): PhpFqcnGlossaryEntry[] {
  try {
    const maxEntries = input.maxEntries ?? MAX_PHP_FQCN_GLOSSARY_ENTRIES;
    const fqcnShape = new RegExp(`^${PHP_IDENTIFIER}(?:\\\\${PHP_IDENTIFIER})*$`);
    const seen = new Set<string>();
    const glossary: PhpFqcnGlossaryEntry[] = [];
    for (const group of input.importGroups) {
      for (const raw of group) {
        if (glossary.length >= maxEntries) return glossary;
        if (typeof raw !== 'string') continue;
        const fqcn = raw.trim().replace(/^\\+/, '');
        // Un solo segmento (sin `\`) es una clase global/interna de PHP: la sección no las lista y `X → X` solo gasta tokens.
        if (!fqcn.includes('\\') || !fqcnShape.test(fqcn) || input.excludeFqcns.has(fqcn) || seen.has(fqcn)) continue;
        seen.add(fqcn);
        glossary.push({ typeName: fqcn.slice(fqcn.lastIndexOf('\\') + 1), fqcn });
      }
    }
    return glossary;
  } catch {
    return [];
  }
}

/**
 * Lee la lista de parámetros desde `(` hasta su `)` de cierre, omitiendo atributos y comentarios. Devuelve el
 * texto normalizado y el índice del `)` de cierre (WI-CORE-104 lo usa para leer el tipo de retorno).
 */
function readParameterList(content: string, open: number): { text: string; end: number } | null {
  const parameters: string[] = [];
  let current = '';
  let depth = 0;
  let index = open + 1;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "'" || char === '"') {
      const end = findStringEnd(content, index);
      if (end < 0) return null;
      current += content.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if ((char === '/' && next === '/') || (char === '#' && next !== '[')) {
      const newline = content.indexOf('\n', index);
      if (newline < 0) return null;
      current += ' ';
      index = newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      if (end < 0) return null;
      current += ' ';
      index = end + 2;
      continue;
    }
    if (char === '#' && next === '[') {
      const end = findAttributeEnd(content.slice(index));
      if (end < 0) return null;
      index += end + 1;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        if (char !== ')') return null;
        parameters.push(current);
        return {
          text: parameters
            .map((parameter) => parameter.replace(/\s+/g, ' ').trim())
            .filter((parameter) => parameter !== '')
            .join(', '),
          end: index,
        };
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parameters.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  return null;
}

/** Índice de la comilla de cierre de la cadena que empieza en `start`, o -1. */
function findStringEnd(content: string, start: number): number {
  const quote = content[start];
  for (let index = start + 1; index < content.length; index += 1) {
    if (content[index] === '\\') index += 1;
    else if (content[index] === quote) return index;
  }
  return -1;
}

export interface CappedPhpDependencySection {
  entries: PhpDependencyEntry[];
  glossary: PhpFqcnGlossaryEntry[];
  truncated: boolean;
  tokenCount: number;
  text: string;
}

/**
 * Recorta por el final hasta que la sección completa (dependencias + glosario) cabe en `maxTokens`.
 * Orden (WI-CORE-104): (1) entradas del glosario desde la última; (2) fábricas, desde la última entrada
 * (la línea conserva el aviso de constructor no público); (3) política vigente: entradas de profundidad 2
 * desde la última (WI-CORE-066), firmas de constructor desde la última entrada (WI-CORE-065); (4) entradas
 * desde la última. `tokenCount` y `text` son los de la sección resultante.
 */
export function capPhpDependencySection(
  entries: readonly PhpDependencyEntry[],
  glossary: readonly PhpFqcnGlossaryEntry[],
  maxTokens: number = MAX_PHP_DEPENDENCY_TOKENS,
): CappedPhpDependencySection {
  const kept = entries.map((entry) => ({ ...entry }));
  const keptGlossary = [...glossary];
  let truncated = false;
  const exceeds = (): boolean => countPhpDependencyTokens(renderFullSection(kept, keptGlossary)) > maxTokens;

  while (keptGlossary.length > 0 && exceeds()) {
    keptGlossary.pop();
    truncated = true;
  }
  for (let index = kept.length - 1; index >= 0 && exceeds(); index -= 1) {
    if (kept[index].factories !== undefined && kept[index].factories!.length > 0) {
      kept[index].factories = [];
      truncated = true;
    }
  }
  // WI-CORE-066: primero se retiran las de profundidad 2, de la última hacia la primera.
  for (let index = kept.length - 1; index >= 0 && exceeds(); index -= 1) {
    if (kept[index].via !== undefined) {
      kept.splice(index, 1);
      truncated = true;
    }
  }
  // Después, la política vigente sobre las directas: firmas de atrás hacia adelante, luego entradas.
  // Con constructor no público la firma no se imprime, así que retirarla no recorta nada.
  for (let index = kept.length - 1; index >= 0 && exceeds(); index -= 1) {
    if (kept[index].signature !== undefined && kept[index].constructorVisibility === undefined) {
      delete kept[index].signature;
      truncated = true;
    }
  }
  while (kept.length > 0 && exceeds()) {
    kept.pop();
    truncated = true;
  }
  const text = renderFullSection(kept, keptGlossary);
  return {
    entries: kept,
    glossary: keptGlossary,
    truncated,
    tokenCount: countPhpDependencyTokens(text),
    text,
  };
}

/** Solo dependencias (sin glosario): la política de recorte de WI-CORE-065/066 más las fábricas (WI-CORE-104). */
export function applyDependencyTokenCap(
  entries: readonly PhpDependencyEntry[],
  maxTokens: number = MAX_PHP_DEPENDENCY_TOKENS,
): CappedPhpDependencies {
  const capped = capPhpDependencySection(entries, [], maxTokens);
  return { entries: capped.entries, truncated: capped.truncated, tokenCount: capped.tokenCount };
}

/**
 * WI-CORE-104 (R2b): sección final = dependencias de `base` (con R2a) y, después, el glosario de FQCN, todo
 * bajo `maxTokens`. `base` puede ser null (sin dependencias): con glosario no vacío se crea una sección con
 * `entries: []` y `unresolvedCount: 0`. Devuelve `base` sin cambios con glosario vacío y null si no queda nada
 * que mostrar (sin base y el glosario se recortó entero).
 */
export function composePhpDependencySection(
  base: PhpDependencySection | null,
  glossary: readonly PhpFqcnGlossaryEntry[],
  maxTokens: number = MAX_PHP_DEPENDENCY_TOKENS,
): PhpDependencySection | null {
  if (glossary.length === 0) return base;
  const capped = capPhpDependencySection(
    [...(base?.entries ?? []), ...(base?.transitiveEntries ?? [])],
    glossary,
    maxTokens,
  );
  if (base === null && capped.glossary.length === 0) return null;
  return {
    entries: capped.entries.filter((entry) => entry.via === undefined),
    transitiveEntries: capped.entries.filter((entry) => entry.via !== undefined),
    unresolvedCount: base?.unresolvedCount ?? 0,
    truncated: (base?.truncated ?? false) || capped.truncated,
    tokenCount: capped.tokenCount,
    text: capped.text,
  };
}

function buildResolutionContext(input: ResolvePhpDependenciesInput): ResolutionContext {
  return buildContextFromImports(
    input.declaringClass,
    [
      ...input.classImports,
      ...(input.constructorChunk?.importsUsed ?? []),
      ...input.methodChunk.importsUsed,
    ],
    input.knownTypes,
  );
}

function buildContextFromImports(
  declaringClass: string,
  allImports: readonly string[],
  knownTypes: ReadonlySet<string>,
): ResolutionContext {
  const importByShortName = new Map<string, string>();
  for (const rawImport of allImports) {
    const fqcn = rawImport.replace(/^\\/, '');
    const shortName = fqcn.slice(fqcn.lastIndexOf('\\') + 1);
    if (!importByShortName.has(shortName)) importByShortName.set(shortName, fqcn);
  }

  const separator = declaringClass.lastIndexOf('\\');
  const declaringNamespacePrefix = separator >= 0 ? `${declaringClass.slice(0, separator)}\\` : '';
  return { declaringNamespacePrefix, importByShortName, knownTypes };
}

function resolveName(rawName: string, context: ResolutionContext): NameResolution {
  if (rawName.startsWith('\\')) {
    const literal = rawName.slice(1);
    const isGlobalInternalClass =
      !literal.includes('\\') && GLOBAL_CLASSES_WITHOUT_IMPORT.has(literal.toLowerCase());
    if (isGlobalInternalClass) return { kind: 'skip' };
    return { kind: 'resolved', fqcn: literal, resolvedBy: 'LITERAL' };
  }

  if (SCALAR_OR_PSEUDO_TYPES.has(rawName.toLowerCase())) return { kind: 'skip' };

  const imported = context.importByShortName.get(rawName);
  if (imported !== undefined) return { kind: 'resolved', fqcn: imported, resolvedBy: 'IMPORT' };

  if (GLOBAL_CLASSES_WITHOUT_IMPORT.has(rawName.toLowerCase())) return { kind: 'skip' };

  const sameNamespace = `${context.declaringNamespacePrefix}${rawName}`;
  if (context.knownTypes.has(sameNamespace)) {
    return { kind: 'resolved', fqcn: sameNamespace, resolvedBy: 'SAME_NAMESPACE' };
  }

  return { kind: 'unresolved' };
}

interface TypeCandidate {
  rawName: string;
  shortName: string;
  origin: PhpDependencyOrigin;
}

function extractTypeNames(content: string | null, origin: PhpDependencyOrigin): TypeCandidate[] {
  if (content === null) return [];
  const signature = splitSignature(content);
  if (signature === null) return [];

  const typeExpressions = [...signature.paramTypes];
  if (origin === 'METHOD_SIGNATURE' && signature.returnType !== null) typeExpressions.push(signature.returnType);

  return typeExpressions.flatMap((expression) =>
    splitTypeExpression(expression).map((rawName) => ({
      rawName,
      shortName: rawName.slice(rawName.lastIndexOf('\\') + 1),
      origin,
    })),
  );
}

interface SplitSignature {
  paramTypes: string[];
  returnType: string | null;
}

/** Extrae los tipos de los parámetros y el tipo de retorno de la primera lista de parámetros. */
function splitSignature(content: string): SplitSignature | null {
  const functionMatch = /\bfunction\b/.exec(content);
  const searchStart = functionMatch?.index ?? 0;
  const open = content.indexOf('(', searchStart);
  if (open < 0) return null;

  const close = findMatchingParenthesis(content, open);
  if (close < 0) return null;

  const paramTypes = splitTopLevel(content.slice(open + 1, close))
    .map(parameterType)
    .filter((type): type is string => type !== null);

  const returnMatch = /^\s*:\s*([^{;]+)/.exec(content.slice(close + 1));
  return { paramTypes, returnType: returnMatch ? returnMatch[1].trim() : null };
}

function findMatchingParenthesis(content: string, open: number): number {
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === '(') depth += 1;
    else if (content[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Divide por comas fuera de paréntesis, corchetes o llaves. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/** Tipo declarado de un parámetro (sin modificadores de promoción, valor por defecto ni nombre). */
function parameterType(parameter: string): string | null {
  const withoutDefault = parameter.split('=')[0] ?? '';
  const variableIndex = withoutDefault.indexOf('$');
  if (variableIndex < 0) return null;
  const type = withoutDefault
    .slice(0, variableIndex)
    .replace(/^\s*(?:(?:public|private|protected|readonly)\s+)+/, '')
    .replace(/[\s&.]+$/, '')
    .trim();
  return type === '' ? null : type;
}

/** Nombres individuales de una expresión de tipo: `?A`, `A|B`, `A&B`, `\Vendor\Pkg\Thing`. */
function splitTypeExpression(expression: string): string[] {
  return expression
    .replace(/^\?/, '')
    .split(/[|&]/)
    .map((name) => name.trim().replace(/^\?/, '').replace(/[()]/g, '').trim())
    .filter((name) => name !== '');
}
