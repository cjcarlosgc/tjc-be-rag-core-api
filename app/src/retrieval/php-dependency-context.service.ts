import { Injectable, Logger } from '@nestjs/common';
import { CodeChunksRepository, type CodeChunkDependencyFields } from '../project-versions/persistence/code-chunks.repository.js';
import {
  applyDependencyTokenCap,
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
      const finalTypes = await this.resolveFinalTypes(projectVersionId, firstPass.entries.map((entry) => entry.fqcn));
      const resolved = finalTypes.size > 0 ? resolvePhpDependencies({ ...input, finalTypes }) : firstPass;
      const capped = applyDependencyTokenCap(resolved.entries, MAX_PHP_DEPENDENCY_TOKENS);

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
   * WI-CORE-058: FQCN resueltos cuya declaración del índice es final o enum. Best-effort: si la consulta
   * falla no se afirma nada (conjunto vacío) y la sección se renderiza sin marcas.
   */
  private async resolveFinalTypes(projectVersionId: string, fqcns: string[]): Promise<Set<string>> {
    const finalTypes = new Set<string>();
    const lookup = [...new Set(fqcns)].slice(0, MAX_FINAL_LOOKUPS);
    if (lookup.length === 0) return finalTypes;
    try {
      const declarations = await this.codeChunks.findPhpTypeDeclarations(projectVersionId, lookup);
      for (const declaration of declarations) {
        if (isFinalPhpDeclaration(declaration.content, declaration.symbolKind)) finalTypes.add(declaration.symbolName);
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Marcas final de dependencias PHP omitidas por error de repositorio: ${errorName}`);
      return new Set<string>();
    }
    return finalTypes;
  }
}
