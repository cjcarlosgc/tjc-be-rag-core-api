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
}

export interface ResolvePhpDependenciesResult {
  entries: PhpDependencyEntry[];
  unresolvedCount: number;
  truncated: boolean;
}

export interface CappedPhpDependencies {
  entries: PhpDependencyEntry[];
  truncated: boolean;
  tokenCount: number;
}

export const MAX_PHP_DEPENDENCY_ENTRIES = 20;
export const MAX_PHP_DEPENDENCY_TOKENS = 300;

const SECTION_HEADER =
  'Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`):';

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

/** Texto de la sección; vacío si no hay entradas. */
export function renderPhpDependencySection(entries: readonly PhpDependencyEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map(
    (entry) => `- ${entry.typeName} → ${entry.fqcn} (${entry.origin === 'CONSTRUCTOR' ? 'constructor' : 'firma del método'})`,
  );
  return [SECTION_HEADER, ...lines].join('\n');
}

/** Tokens de la sección con el mismo tokenizador que los chunks (`cl100k_base`). */
export function countPhpDependencyTokens(text: string): number {
  if (text === '') return 0;
  return countTokens(text);
}

/** Recorta entradas por el final hasta que la sección renderizada cabe en `maxTokens`. */
export function applyDependencyTokenCap(
  entries: readonly PhpDependencyEntry[],
  maxTokens: number = MAX_PHP_DEPENDENCY_TOKENS,
): CappedPhpDependencies {
  const kept = [...entries];
  let truncated = false;
  while (kept.length > 0 && countPhpDependencyTokens(renderPhpDependencySection(kept)) > maxTokens) {
    kept.pop();
    truncated = true;
  }
  return {
    entries: kept,
    truncated,
    tokenCount: countPhpDependencyTokens(renderPhpDependencySection(kept)),
  };
}

function buildResolutionContext(input: ResolvePhpDependenciesInput): ResolutionContext {
  const importByShortName = new Map<string, string>();
  const allImports = [
    ...input.classImports,
    ...(input.constructorChunk?.importsUsed ?? []),
    ...input.methodChunk.importsUsed,
  ];
  for (const rawImport of allImports) {
    const fqcn = rawImport.replace(/^\\/, '');
    const shortName = fqcn.slice(fqcn.lastIndexOf('\\') + 1);
    if (!importByShortName.has(shortName)) importByShortName.set(shortName, fqcn);
  }

  const separator = input.declaringClass.lastIndexOf('\\');
  const declaringNamespacePrefix = separator >= 0 ? `${input.declaringClass.slice(0, separator)}\\` : '';
  return { declaringNamespacePrefix, importByShortName, knownTypes: input.knownTypes };
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
