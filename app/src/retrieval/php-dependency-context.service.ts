import { Injectable, Logger } from '@nestjs/common';
import { CodeChunksRepository, type CodeChunkDependencyFields } from '../project-versions/persistence/code-chunks.repository.js';
import {
  applyDependencyTokenCap,
  extractPhpConstructorSignature,
  isFinalPhpDeclaration,
  MAX_PHP_DEPENDENCY_TOKENS,
  renderPhpDependencySection,
  resolvePhpDependencies,
  type PhpDependencyEntry,
} from './php-dependency-context.js';

export interface PhpDependencyContext {
  entries: PhpDependencyEntry[];
  unresolvedCount: number;
  truncated: boolean;
  tokenCount: number;
  text: string;
}

const METHOD_KINDS = new Set(['METHOD', 'CONSTRUCTOR', 'FUNCTION']);
const MAX_FINAL_LOOKUPS = 20;
const MAX_CONSTRUCTOR_LOOKUPS = 20;

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
        index.finalTypes.size > 0 ? resolvePhpDependencies({ ...input, finalTypes: index.finalTypes }) : firstPass;
      const signatures = await this.resolveConstructorSignatures(
        projectVersionId,
        resolved.entries.map((entry) => entry.fqcn),
        index.kinds,
      );
      const withSignatures = resolved.entries.map((entry) => {
        const signature = signatures.get(entry.fqcn);
        return signature === undefined ? entry : { ...entry, signature };
      });
      const capped = applyDependencyTokenCap(withSignatures, MAX_PHP_DEPENDENCY_TOKENS);

      if (capped.entries.length === 0 && resolved.unresolvedCount === 0) return null;

      return {
        entries: capped.entries,
        unresolvedCount: resolved.unresolvedCount,
        truncated: resolved.truncated || capped.truncated,
        tokenCount: capped.tokenCount,
        text: renderPhpDependencySection(capped.entries),
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Sección de dependencias PHP omitida por error de repositorio: ${errorName}`);
      return null;
    }
  }

  /**
   * WI-CORE-058: FQCN resueltos cuya declaración del índice es final o enum; WI-CORE-065: su symbolKind.
   * Best-effort: si la consulta falla no se afirma nada (índice vacío) y la sección se renderiza sin marcas.
   */
  private async indexTypeDeclarations(
    projectVersionId: string,
    fqcns: string[],
  ): Promise<{ finalTypes: Set<string>; kinds: Map<string, string> }> {
    const index = { finalTypes: new Set<string>(), kinds: new Map<string, string>() };
    const lookup = [...new Set(fqcns)].slice(0, MAX_FINAL_LOOKUPS);
    if (lookup.length === 0) return index;
    try {
      const declarations = await this.codeChunks.findPhpTypeDeclarations(projectVersionId, lookup);
      for (const declaration of declarations) {
        index.kinds.set(declaration.symbolName, declaration.symbolKind);
        if (isFinalPhpDeclaration(declaration.content, declaration.symbolKind)) index.finalTypes.add(declaration.symbolName);
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Índice de declaraciones PHP omitido por error de repositorio: ${errorName}`);
      return { finalTypes: new Set<string>(), kinds: new Map<string, string>() };
    }
    return index;
  }

  /**
   * WI-CORE-065: firma del constructor por FQCN. Excluye los que el índice conoce como interfaz, enum o
   * trait. Best-effort: un error de consulta deja el mapa vacío y no se propaga.
   */
  private async resolveConstructorSignatures(
    projectVersionId: string,
    fqcns: string[],
    kinds: ReadonlyMap<string, string>,
  ): Promise<Map<string, string>> {
    const signatures = new Map<string, string>();
    const lookup = [...new Set(fqcns)]
      .filter((fqcn) => {
        const kind = kinds.get(fqcn);
        return kind === undefined || kind === 'CLASS';
      })
      .slice(0, MAX_CONSTRUCTOR_LOOKUPS);
    if (lookup.length === 0) return signatures;
    try {
      const declarations = await this.codeChunks.findPhpConstructorDeclarations(projectVersionId, lookup);
      for (const declaration of declarations) {
        if (!lookup.includes(declaration.parentSymbolName)) continue;
        const signature = extractPhpConstructorSignature(declaration.content);
        if (signature !== null) signatures.set(declaration.parentSymbolName, signature);
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Firmas de constructor PHP omitidas por error de repositorio: ${errorName}`);
      return new Map<string, string>();
    }
    return signatures;
  }
}
