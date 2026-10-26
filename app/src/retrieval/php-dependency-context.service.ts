import { Injectable, Logger } from '@nestjs/common';
import { CodeChunksRepository, type CodeChunkDependencyFields } from '../project-versions/persistence/code-chunks.repository.js';
import {
  capPhpDependencySection,
  extractPhpConstructorSignature,
  extractPhpConstructorVisibility,
  extractPhpPublicStaticFactories,
  isFinalPhpDeclaration,
  MAX_PHP_DEPENDENCY_ENTRIES,
  MAX_PHP_DEPENDENCY_TOKENS,
  MAX_PHP_FACTORIES_PER_CLASS,
  resolvePhpConstructorTypes,
  resolvePhpDependencies,
  resolvePhpTypeName,
  type PhpConstructorVisibility,
  type PhpDependencyEntry,
  type PhpDependencySection,
} from './php-dependency-context.js';
import {
  computeInheritedAbstractObligations,
  extractPhpAbstractMethod,
  extractPhpImplementedMethodName,
  extractPhpInterfaceMethodSignatures,
  parsePhpTypeHeader,
  phpClassUsesTraits,
  type AncestorHierarchyInfo,
  type PhpAbstractMethod,
  type PhpTypeHeader,
} from './php-class-hierarchy.js';

/**
 * Sección de dependencias PHP. WI-CORE-104: el texto puede incluir el glosario de FQCN, que añade el pipeline
 * con `composePhpDependencySection`; aquí solo se arman las dependencias.
 */
export type PhpDependencyContext = PhpDependencySection;

/** WI-CORE-065: firma y datos del constructor de una dependencia directa, para la profundidad 2. */
interface ConstructorInfo {
  signature: string;
  content: string;
  importsUsed: string[];
  /** WI-CORE-104 (R2a): visibilidad declarada del constructor; null si no se pudo leer. */
  visibility: PhpConstructorVisibility | null;
}

const METHOD_KINDS = new Set(['METHOD', 'CONSTRUCTOR', 'FUNCTION']);
const MAX_FINAL_LOOKUPS = 20;
const MAX_CONSTRUCTOR_LOOKUPS = 20;
const MAX_TRANSITIVE_LOOKUPS = 20;
const MAX_FACTORY_LOOKUPS = 20;
/** WI-CORE-106: profundidad máxima de la jerarquía (interfaces/padres) y tipos por consulta. */
const MAX_HIERARCHY_DEPTH = 3;
const MAX_HIERARCHY_TYPES_PER_QUERY = 20;
const MAX_HIERARCHY_PART_ROWS = 400;
const MAX_HIERARCHY_METHOD_ROWS = 600;

/**
 * Sección best-effort de dependencias PHP del código objetivo. Un fallo del repositorio no se
 * propaga: se registra un warn y la generación continúa sin la sección.
 */
@Injectable()
export class PhpDependencyContextService {
  private readonly logger = new Logger(PhpDependencyContextService.name);

  constructor(private readonly codeChunks: CodeChunksRepository) {}

  async resolve(
    projectVersionId: string,
    targetChunks: CodeChunkDependencyFields[],
    language: 'php' | 'typescript',
  ): Promise<PhpDependencyContext | null> {
    if (language !== 'php') return null;
    const methodChunk = targetChunks.find((chunk) => METHOD_KINDS.has(chunk.symbolKind));
    const declaringClass = methodChunk?.parentSymbolName ?? null;
    if (!methodChunk || declaringClass === null) return null;

    try {
      const fileChunks = await this.codeChunks.findByFile(projectVersionId, methodChunk.filePath);
      const classChunk = fileChunks.find((chunk) => chunk.symbolKind === 'CLASS' && chunk.symbolName === declaringClass);
      const constructorChunk = fileChunks.find(
        (chunk) => chunk.symbolKind === 'CONSTRUCTOR' && chunk.parentSymbolName === declaringClass,
      );
      const knownTypes = new Set(await this.codeChunks.findPhpTypeSymbolNames(projectVersionId));

      const input = {
        declaringClass,
        classImports: classChunk?.importsUsed ?? [],
        constructorChunk: constructorChunk ? { content: constructorChunk.content, importsUsed: constructorChunk.importsUsed } : null,
        methodChunk: { content: methodChunk.content, importsUsed: methodChunk.importsUsed },
        knownTypes,
      };
      const firstPass = resolvePhpDependencies(input);
      const index = await this.indexTypeDeclarations(projectVersionId, firstPass.entries.map((entry) => entry.fqcn));
      const resolved =
        index.finalTypes.size > 0
          ? resolvePhpDependencies({ ...input, finalTypes: index.finalTypes, enumTypes: index.enumTypes })
          : firstPass;
      const constructors = await this.resolveConstructorInfo(
        projectVersionId,
        resolved.entries.map((entry) => entry.fqcn),
        index.kinds,
      );
      // WI-CORE-104 (R2a): solo directas que el índice confirma como CLASS con constructor no público.
      const nonPublicConstructors = resolved.entries
        .filter((entry) => {
          const visibility = constructors.get(entry.fqcn)?.visibility;
          return index.kinds.get(entry.fqcn) === 'CLASS' && (visibility === 'private' || visibility === 'protected');
        })
        .map((entry) => entry.fqcn);
      const factories = await this.resolveFactories(projectVersionId, nonPublicConstructors);
      const withSignatures = resolved.entries.map((entry): PhpDependencyEntry => {
        const info = constructors.get(entry.fqcn);
        if (info === undefined) return entry;
        if (nonPublicConstructors.includes(entry.fqcn) && (info.visibility === 'private' || info.visibility === 'protected')) {
          // La firma de un constructor no público sería engañosa: no se guarda ni se imprime.
          return { ...entry, constructorVisibility: info.visibility, factories: factories.get(entry.fqcn) ?? [] };
        }
        return { ...entry, signature: info.signature };
      });
      const transitive = await this.resolveTransitiveEntries(
        projectVersionId,
        withSignatures,
        constructors,
        index.kinds,
        knownTypes,
        declaringClass,
      );
      // WI-CORE-106: obligaciones abstractas heredadas; solo para clase declarante abstracta o interfaz.
      const obligations = await this.resolveAbstractObligations(
        projectVersionId,
        declaringClass,
        fileChunks,
        knownTypes,
      );
      const capped = capPhpDependencySection(
        [...withSignatures, ...transitive.entries],
        [],
        MAX_PHP_DEPENDENCY_TOKENS,
        obligations.lines,
        obligations.uncertain,
      );
      const kept = capped.entries;

      if (kept.length === 0 && resolved.unresolvedCount === 0 && capped.abstractObligations.length === 0) return null;

      return {
        entries: kept.filter((entry) => entry.via === undefined),
        transitiveEntries: kept.filter((entry) => entry.via !== undefined),
        unresolvedCount: resolved.unresolvedCount,
        truncated: resolved.truncated || transitive.truncated || capped.truncated,
        tokenCount: capped.tokenCount,
        text: capped.text,
        ...(capped.abstractObligations.length > 0 ? { abstractObligations: capped.abstractObligations } : {}),
        ...(capped.abstractObligationsUncertain ? { abstractObligationsUncertain: true as const } : {}),
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Sección de dependencias PHP omitida por error de repositorio: ${errorName}`);
      return null;
    }
  }

  /**
   * WI-CORE-106: líneas `Owner::nombre(params): retorno` de los métodos abstractos sin implementar de la jerarquía
   * de la clase declarante, solo si es una clase `abstract` o una interfaz (clase concreta, cabecera ilegible o
   * sin chunk de clase: nada). Recorre las interfaces y clases padre en anchura hasta profundidad 3 con el
   * resolutor de nombres existente (solo tipos del índice; ciclos y duplicados se descartan; traits, enums y tipos
   * ausentes del índice se ignoran). `uncertain` es true cuando la jerarquía no se conoce por completo: una clase
   * de la cadena usa traits, un `extends`/`implements` no resuelve a un tipo del índice, o el recorrido se cortó por
   * la profundidad 3 o por el tope de 20 tipos. Solo cuentan como implementados los métodos `public`/`protected`.
   * Best-effort: un error de consulta no se propaga y deja la sección sin bloque.
   */
  private async resolveAbstractObligations(
    projectVersionId: string,
    declaringClass: string,
    fileChunks: CodeChunkDependencyFields[],
    knownTypes: ReadonlySet<string>,
  ): Promise<{ lines: string[]; uncertain: boolean }> {
    const none = { lines: [] as string[], uncertain: false };
    try {
      const declaringParts = fileChunks.filter(
        (chunk) => (chunk.symbolKind === 'CLASS' || chunk.symbolKind === 'INTERFACE') && chunk.symbolName === declaringClass,
      );
      const declaringChunk = declaringParts[0];
      if (declaringChunk === undefined) return none;
      const header = parsePhpTypeHeader(declaringChunk.content);
      if (header === null) return none;
      const isInterface = header.kind === 'interface' && declaringChunk.symbolKind === 'INTERFACE';
      const isAbstractClass = header.kind === 'class' && header.isAbstract && declaringChunk.symbolKind === 'CLASS';
      if (!isInterface && !isAbstractClass) return none;

      // Una clase declarante que usa traits puede recibir métodos que el índice no ve.
      let uncertain = !isInterface && phpClassUsesTraits(declaringChunk.content);
      const declaringImports = declaringParts.flatMap((chunk) => chunk.importsUsed ?? []);
      let abstractMethods: PhpAbstractMethod[] = [];
      const implementedMethodNames: string[] = [];
      if (isInterface) {
        abstractMethods = interfaceMethods(declaringParts.map((chunk) => chunk.content));
      } else {
        for (const chunk of fileChunks) {
          if ((chunk.symbolKind !== 'METHOD' && chunk.symbolKind !== 'CONSTRUCTOR') || chunk.parentSymbolName !== declaringClass) {
            continue;
          }
          const abstractMethod = extractPhpAbstractMethod(chunk.content);
          if (abstractMethod !== null) {
            abstractMethods.push(abstractMethod);
            continue;
          }
          const name = extractPhpImplementedMethodName(chunk.content);
          if (name !== null) implementedMethodNames.push(name);
        }
      }

      const visited = new Set<string>([declaringClass]);
      const nextFrontier = (parents: string[]): string[] => {
        const frontier: string[] = [];
        for (const fqcn of parents) {
          if (visited.has(fqcn)) continue;
          if (frontier.length >= MAX_HIERARCHY_TYPES_PER_QUERY) {
            uncertain = true;
            continue;
          }
          visited.add(fqcn);
          frontier.push(fqcn);
        }
        return frontier;
      };
      const resolveParents = (owner: string, typeHeader: PhpTypeHeader, imports: readonly string[]): string[] => {
        const resolved: string[] = [];
        for (const rawName of [...typeHeader.extendsNames, ...typeHeader.implementsNames]) {
          const fqcn = resolvePhpTypeName(rawName, { ownerFqcn: owner, importsUsed: imports, knownTypes });
          // Clase interna de PHP, de vendor/ o no verificable: no se sabe qué métodos aporta.
          if (fqcn === null) uncertain = true;
          else resolved.push(fqcn);
        }
        return resolved;
      };

      const ancestors: AncestorHierarchyInfo[] = [];
      let frontier = nextFrontier(resolveParents(declaringClass, header, declaringImports));
      for (let level = 1; level <= MAX_HIERARCHY_DEPTH && frontier.length > 0; level += 1) {
        const rows = await this.codeChunks.findPhpTypeDeclarationParts(projectVersionId, frontier, MAX_HIERARCHY_PART_ROWS);
        const partsBySymbol = new Map<string, typeof rows>();
        for (const row of rows) {
          const list = partsBySymbol.get(row.symbolName) ?? [];
          list.push(row);
          partsBySymbol.set(row.symbolName, list);
        }
        const parents: string[] = [];
        const levelClasses: Array<{ fqcn: string }> = [];
        const levelAncestors = new Map<string, AncestorHierarchyInfo>();
        for (const fqcn of frontier) {
          const parts = [...(partsBySymbol.get(fqcn) ?? [])].sort((left, right) => left.partIndex - right.partIndex);
          const first = parts[0];
          const kind = first === undefined ? null : first.symbolKind === 'INTERFACE' ? 'interface' : first.symbolKind === 'CLASS' ? 'class' : null;
          const typeHeader = first !== undefined && first.partIndex === 1 && kind !== null ? parsePhpTypeHeader(first.content) : null;
          if (first === undefined || kind === null || typeHeader === null || typeHeader.kind !== kind) {
            // Fuera del índice, ambiguo, trait/enum o cabecera ilegible: se ignora, pero la lista pierde certeza.
            uncertain = true;
            continue;
          }
          if (kind === 'class' && phpClassUsesTraits(first.content)) uncertain = true;
          const imports = parts.flatMap((part) => part.importsUsed ?? []);
          parents.push(...resolveParents(fqcn, typeHeader, imports));
          const info: AncestorHierarchyInfo = {
            name: shortName(fqcn),
            kind,
            level,
            abstractMethods: kind === 'interface' ? interfaceMethods(parts.map((part) => part.content)) : [],
            implementedMethodNames: [],
          };
          levelAncestors.set(fqcn, info);
          if (kind === 'class') levelClasses.push({ fqcn });
        }
        if (levelClasses.length > 0) {
          const methods = await this.codeChunks.findPhpMethodDeclarations(
            projectVersionId,
            levelClasses.map((entry) => entry.fqcn),
            MAX_HIERARCHY_METHOD_ROWS,
          );
          for (const method of methods) {
            const info = levelAncestors.get(method.parentSymbolName);
            if (info === undefined || info.kind !== 'class') continue;
            const abstractMethod = extractPhpAbstractMethod(method.content);
            if (abstractMethod !== null) {
              info.abstractMethods.push(abstractMethod);
              continue;
            }
            const name = extractPhpImplementedMethodName(method.content);
            if (name !== null) info.implementedMethodNames.push(name);
          }
        }
        ancestors.push(...levelAncestors.values());
        frontier = nextFrontier(parents);
      }
      // Quedaron ancestros sin visitar por el límite de profundidad.
      if (frontier.length > 0) uncertain = true;

      const computed = computeInheritedAbstractObligations({
        declaring: {
          name: shortName(declaringClass),
          isAbstract: true,
          implementedMethodNames,
          abstractMethods,
        },
        ancestors,
      });
      const lines = computed.methods.map((method) => `${method.owner}::${method.signature}`);
      return { lines, uncertain: lines.length > 0 && uncertain };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Obligaciones abstractas PHP omitidas por error de repositorio: ${errorName}`);
      return none;
    }
  }

  /**
   * WI-CORE-058: FQCN resueltos cuya declaración del índice es final o enum; WI-CORE-065: su symbolKind.
   * Best-effort: si la consulta falla no se afirma nada (índice vacío) y la sección se renderiza sin marcas.
   */
  private async indexTypeDeclarations(
    projectVersionId: string,
    fqcns: string[],
  ): Promise<{ finalTypes: Set<string>; enumTypes: Set<string>; kinds: Map<string, string> }> {
    const index = { finalTypes: new Set<string>(), enumTypes: new Set<string>(), kinds: new Map<string, string>() };
    const lookup = [...new Set(fqcns)].slice(0, MAX_FINAL_LOOKUPS);
    if (lookup.length === 0) return index;
    try {
      const declarations = await this.codeChunks.findPhpTypeDeclarations(projectVersionId, lookup);
      for (const declaration of declarations) {
        index.kinds.set(declaration.symbolName, declaration.symbolKind);
        if (declaration.symbolKind === 'ENUM') index.enumTypes.add(declaration.symbolName);
        if (isFinalPhpDeclaration(declaration.content, declaration.symbolKind)) index.finalTypes.add(declaration.symbolName);
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Índice de declaraciones PHP omitido por error de repositorio: ${errorName}`);
      return { finalTypes: new Set<string>(), enumTypes: new Set<string>(), kinds: new Map<string, string>() };
    }
    return index;
  }

  /**
   * WI-CORE-065: firma del constructor por FQCN (y su contenido para la profundidad 2). Excluye los que el
   * índice conoce como interfaz, enum o trait. Best-effort: un error de consulta deja el mapa vacío.
   */
  private async resolveConstructorInfo(
    projectVersionId: string,
    fqcns: string[],
    kinds: ReadonlyMap<string, string>,
  ): Promise<Map<string, ConstructorInfo>> {
    const constructors = new Map<string, ConstructorInfo>();
    const lookup = [...new Set(fqcns)]
      .filter((fqcn) => {
        const kind = kinds.get(fqcn);
        return kind === undefined || kind === 'CLASS';
      })
      .slice(0, MAX_CONSTRUCTOR_LOOKUPS);
    if (lookup.length === 0) return constructors;
    try {
      const declarations = await this.codeChunks.findPhpConstructorDeclarations(projectVersionId, lookup);
      for (const declaration of declarations) {
        if (!lookup.includes(declaration.parentSymbolName)) continue;
        const signature = extractPhpConstructorSignature(declaration.content);
        if (signature !== null) {
          constructors.set(declaration.parentSymbolName, {
            signature,
            content: declaration.content,
            importsUsed: declaration.importsUsed ?? [],
            visibility: extractPhpConstructorVisibility(declaration.content),
          });
        }
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Firmas de constructor PHP omitidas por error de repositorio: ${errorName}`);
      return new Map<string, ConstructorInfo>();
    }
    return constructors;
  }

  /**
   * WI-CORE-104 (R2a): fábricas públicas estáticas (`nombre(params): retorno`) de las clases dadas, tomadas de
   * sus chunks `METHOD` del mismo `ProjectVersion`: orden estable por nombre y como máximo 4 por clase.
   * Best-effort: un error de repositorio no se propaga y deja el mapa vacío (sin fábricas).
   */
  private async resolveFactories(projectVersionId: string, fqcns: string[]): Promise<Map<string, string[]>> {
    const factories = new Map<string, string[]>();
    const lookup = [...new Set(fqcns)].slice(0, MAX_FACTORY_LOOKUPS);
    if (lookup.length === 0) return factories;
    try {
      const declarations = await this.codeChunks.findPhpStaticMethodDeclarations(projectVersionId, lookup);
      for (const fqcn of lookup) {
        const found = new Set<string>();
        for (const declaration of declarations) {
          if (declaration.parentSymbolName !== fqcn) continue;
          for (const factory of extractPhpPublicStaticFactories(declaration.content, fqcn)) found.add(factory);
        }
        // El nombre del método siempre precede a `(`, que es menor que cualquier carácter de un identificador.
        const sorted = [...found].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        if (sorted.length > 0) factories.set(fqcn, sorted.slice(0, MAX_PHP_FACTORIES_PER_CLASS));
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Fábricas de constructor no público omitidas por error de repositorio: ${errorName}`);
      return new Map<string, string[]>();
    }
    return factories;
  }

  /**
   * WI-CORE-066: tipos del constructor de cada dependencia directa de clase concreta con constructor, resueltos
   * con el mismo resolutor. Excluye la clase declarante, directas ya presentes, duplicados (gana el primero) y
   * los que el índice no confirma como clase con constructor. Límite: directas + profundidad 2 ≤ 20 y como
   * máximo 20 nombres por consulta. Best-effort: un error de repositorio omite solo esta profundidad.
   */
  private async resolveTransitiveEntries(
    projectVersionId: string,
    directs: PhpDependencyEntry[],
    constructors: ReadonlyMap<string, ConstructorInfo>,
    kinds: ReadonlyMap<string, string>,
    knownTypes: ReadonlySet<string>,
    declaringClass: string,
  ): Promise<{ entries: PhpDependencyEntry[]; truncated: boolean }> {
    const none = { entries: [] as PhpDependencyEntry[], truncated: false };
    const remaining = MAX_PHP_DEPENDENCY_ENTRIES - directs.length;
    if (remaining <= 0) return none;

    const seen = new Set<string>([declaringClass, ...directs.map((entry) => entry.fqcn)]);
    const candidates: Array<{ typeName: string; fqcn: string; resolvedBy: PhpDependencyEntry['resolvedBy']; via: string }> = [];
    for (const direct of directs) {
      if (kinds.get(direct.fqcn) !== 'CLASS') continue;
      const info = constructors.get(direct.fqcn);
      if (info === undefined) continue;
      const references = resolvePhpConstructorTypes({
        declaringClass: direct.fqcn,
        content: info.content,
        importsUsed: info.importsUsed,
        knownTypes,
      });
      for (const reference of references) {
        if (seen.has(reference.fqcn)) continue;
        seen.add(reference.fqcn);
        candidates.push({ ...reference, via: direct.typeName });
      }
    }
    if (candidates.length === 0) return none;

    const limit = Math.min(remaining, MAX_TRANSITIVE_LOOKUPS);
    const truncated = candidates.length > limit;
    const lookup = candidates.slice(0, limit);
    try {
      const declarations = await this.codeChunks.findPhpTypeDeclarations(
        projectVersionId,
        lookup.map((candidate) => candidate.fqcn),
      );
      const classes = new Map(
        declarations
          .filter((declaration) => declaration.symbolKind === 'CLASS')
          .map((declaration) => [declaration.symbolName, declaration] as const),
      );
      const concrete = lookup.filter((candidate) => classes.has(candidate.fqcn));
      if (concrete.length === 0) return { entries: [], truncated };
      const constructorDeclarations = await this.codeChunks.findPhpConstructorDeclarations(
        projectVersionId,
        concrete.map((candidate) => candidate.fqcn),
      );
      const signatures = new Map<string, string>();
      for (const declaration of constructorDeclarations) {
        if (!concrete.some((candidate) => candidate.fqcn === declaration.parentSymbolName)) continue;
        const signature = extractPhpConstructorSignature(declaration.content);
        if (signature !== null) signatures.set(declaration.parentSymbolName, signature);
      }
      const entries: PhpDependencyEntry[] = [];
      for (const candidate of concrete) {
        const signature = signatures.get(candidate.fqcn);
        if (signature === undefined) continue;
        const declaration = classes.get(candidate.fqcn);
        entries.push({
          typeName: candidate.typeName,
          fqcn: candidate.fqcn,
          origin: 'CONSTRUCTOR',
          resolvedBy: candidate.resolvedBy,
          ...(declaration && isFinalPhpDeclaration(declaration.content, declaration.symbolKind) ? { final: true as const } : {}),
          signature,
          via: candidate.via,
        });
      }
      return { entries, truncated };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Profundidad 2 de dependencias PHP omitida por error de repositorio: ${errorName}`);
      return none;
    }
  }
}

function shortName(fqcn: string): string {
  return fqcn.slice(fqcn.lastIndexOf('\\') + 1);
}

/** Métodos (nombre y firma) de las partes de una interfaz. */
function interfaceMethods(contents: readonly string[]): PhpAbstractMethod[] {
  return extractPhpInterfaceMethodSignatures(contents.join('\n'))
    .map((signature) => {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(signature)?.[0];
      return name === undefined ? null : { name, signature };
    })
    .filter((method): method is PhpAbstractMethod => method !== null);
}
