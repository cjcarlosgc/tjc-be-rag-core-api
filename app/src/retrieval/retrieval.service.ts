import { HttpStatus, Injectable } from '@nestjs/common';
import { posix } from 'node:path';
import { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';
import type { CodeChunk } from '../generated/prisma/client.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { RetrievalTarget, StructuralMatch } from './generation-context.js';

export interface RetrievalCandidate {
  chunk: CodeChunk;
  semanticScore: number | null;
  structuralMatch: StructuralMatch | null;
}

export interface RetrievalResult {
  targetChunks: CodeChunk[];
  candidates: RetrievalCandidate[];
}

/**
 * Modo de recuperación (WI-CORE-022, INTEROP-2.7 §6.15). `SE` es el producto: candidatos semánticos
 * unidos con los estructurales. `SEM` es solo semántico: sin relaciones estructurales ni consulta de
 * chunks del proyecto. Sin argumento se usa `SE`, así el flujo del producto no cambia.
 */
export type RetrievalMode = 'SE' | 'SEM';

/** Top-K vectorial por defecto del retrieval del producto (WI-CORE-026 lo persiste en `analysis_retrievals.config`). */
export const DEFAULT_VECTOR_TOP_K = 20;

const SOURCE_EXTENSION_PATTERN = /\.(tsx?|jsx?|mjs|cjs)$/;

function stripExtension(filePath: string): string {
  return filePath.replace(SOURCE_EXTENSION_PATTERN, '');
}

function resolveRelativeImport(fromFilePath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const fromDir = posix.dirname(fromFilePath);
  return stripExtension(posix.normalize(posix.join(fromDir, specifier)));
}

const PHP_SOURCE_PATTERN = /\.php$/;
const PHP_TYPE_KINDS = new Set(['CLASS', 'INTERFACE', 'TRAIT', 'ENUM']);

function isPhpChunk(chunk: CodeChunk): boolean {
  return PHP_SOURCE_PATTERN.test(chunk.filePath);
}

/** Namespace de un FQCN: todo antes del último `\\`; vacío si no hay. */
function namespaceOf(fqcn: string): string {
  const index = fqcn.lastIndexOf('\\');
  return index === -1 ? '' : fqcn.slice(0, index);
}

/** Nombre corto de un FQCN: todo después del último `\\`. */
function shortNameOf(fqcn: string): string {
  return fqcn.slice(fqcn.lastIndexOf('\\') + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingBackslash(fqcn: string): string {
  return fqcn.replace(/^\\/, '');
}

/** `O(K)` de DEC-PHP-RET-001: clase/interfaz/trait/enum que contiene o es el símbolo K. */
function phpOwnerOf(chunk: CodeChunk): string | null {
  return chunk.parentSymbolName ?? (PHP_TYPE_KINDS.has(chunk.symbolKind) ? chunk.symbolName : null);
}

function isSameSymbol(a: CodeChunk, b: CodeChunk): boolean {
  return (
    a.filePath === b.filePath &&
    a.symbolKind === b.symbolKind &&
    a.symbolName === b.symbolName &&
    a.parentSymbolName === b.parentSymbolName
  );
}

@Injectable()
export class RetrievalService {
  constructor(private readonly codeChunksRepository: CodeChunksRepository) {}

  async retrieve(
    projectVersionId: string,
    target: RetrievalTarget,
    vectorTopK = DEFAULT_VECTOR_TOP_K,
    mode: RetrievalMode = 'SE',
  ): Promise<RetrievalResult> {
    const symbolKind = target.targetType === 'METHOD' ? 'METHOD' : 'FUNCTION';
    const symbolName = target.targetType === 'METHOD' ? (target.methodName ?? '') : target.symbolName;
    const parentSymbolName = target.targetType === 'METHOD' ? target.symbolName : null;

    const targetChunks = await this.codeChunksRepository.findBySymbol(
      projectVersionId,
      target.filePath,
      symbolKind,
      symbolName,
      parentSymbolName,
    );

    if (targetChunks.length === 0) {
      throw new AppException(
        ErrorCode.UNRESOLVABLE_TARGET,
        `No se encontró un chunk indexado para ${target.filePath}#${target.methodName ?? target.symbolName}.`,
        HttpStatus.CONFLICT,
      );
    }

    const anchor = targetChunks[0];
    const candidatesById = new Map<string, RetrievalCandidate>();

    if (mode === 'SEM') {
      const semanticCandidates = await this.codeChunksRepository.findSimilarByEmbedding(
        projectVersionId,
        anchor.id,
        vectorTopK,
      );

      for (const chunk of semanticCandidates) {
        if (isSameSymbol(chunk, anchor)) {
          continue;
        }

        candidatesById.set(chunk.id, { chunk, semanticScore: chunk.semanticScore, structuralMatch: null });
      }

      return { targetChunks, candidates: [...candidatesById.values()] };
    }

    const [semanticCandidates, allChunks] = await Promise.all([
      this.codeChunksRepository.findSimilarByEmbedding(projectVersionId, anchor.id, vectorTopK),
      this.codeChunksRepository.findByProjectVersion(projectVersionId),
    ]);

    for (const chunk of semanticCandidates) {
      if (isSameSymbol(chunk, anchor)) {
        continue;
      }

      candidatesById.set(chunk.id, {
        chunk,
        semanticScore: chunk.semanticScore,
        structuralMatch: null,
      });
    }

    const structuralMatches = isPhpChunk(anchor)
      ? this.resolvePhpStructuralMatches(anchor, allChunks)
      : this.resolveStructuralMatches(anchor, allChunks);

    for (const { chunk, relation } of structuralMatches) {
      const existing = candidatesById.get(chunk.id);

      if (existing) {
        existing.structuralMatch = relation;
      } else {
        candidatesById.set(chunk.id, { chunk, semanticScore: null, structuralMatch: relation });
      }
    }

    return { targetChunks, candidates: [...candidatesById.values()] };
  }

  /**
   * Relaciones estructurales PHP (DEC-PHP-RET-001, WI-CORE-028). Solo considera candidatos `.php`.
   * Una etiqueta por candidato: la primera que aplica en el orden R-PHP1 → R-PHP5.
   */
  private resolvePhpStructuralMatches(
    anchor: CodeChunk,
    allChunks: CodeChunk[],
  ): Array<{ chunk: CodeChunk; relation: StructuralMatch }> {
    const anchorClass = anchor.parentSymbolName; // C(A); null si el ancla es una función
    const anchorNamespace = namespaceOf(anchorClass ?? anchor.symbolName ?? ''); // ns(A)
    const anchorImports = new Set(anchor.importsUsed.map(stripLeadingBackslash));
    const matches: Array<{ chunk: CodeChunk; relation: StructuralMatch }> = [];

    for (const chunk of allChunks) {
      if (!isPhpChunk(chunk) || isSameSymbol(chunk, anchor)) {
        continue;
      }

      const owner = phpOwnerOf(chunk); // O(K)
      const relation = this.classifyPhpRelation(chunk, {
        anchorClass,
        anchorNamespace,
        anchorImports,
        anchorContent: anchor.content,
        owner,
      });

      if (relation) {
        matches.push({ chunk, relation });
      }
    }

    return matches;
  }

  private classifyPhpRelation(
    chunk: CodeChunk,
    context: {
      anchorClass: string | null;
      anchorNamespace: string;
      anchorImports: Set<string>;
      anchorContent: string;
      owner: string | null;
    },
  ): StructuralMatch | null {
    const { anchorClass, anchorNamespace, anchorImports, anchorContent, owner } = context;

    // R-PHP1 IMPORTS: el target usa una clase importada con `use` que es O(K).
    if (owner !== null && anchorImports.has(owner)) {
      return 'IMPORTS';
    }

    // R-PHP2 IMPORTED_BY: el candidato importa la clase que declara el target.
    if (
      anchorClass !== null &&
      chunk.importsUsed.map(stripLeadingBackslash).includes(anchorClass)
    ) {
      return 'IMPORTED_BY';
    }

    // R-PHP3 SAME_NAMESPACE: mismo namespace y el target menciona el nombre corto como palabra completa.
    if (
      owner !== null &&
      owner !== anchorClass &&
      namespaceOf(owner) === anchorNamespace &&
      new RegExp(`\\b${escapeRegExp(shortNameOf(owner))}\\b`).test(anchorContent)
    ) {
      return 'SAME_NAMESPACE';
    }

    // R-PHP4 FULLY_QUALIFIED_REFERENCE: el target contiene `\O(K)` seguido de un no-identificador o fin.
    if (
      owner !== null &&
      new RegExp(`\\\\${escapeRegExp(owner)}(?![\\w\\u0080-\\uFFFF])`).test(anchorContent)
    ) {
      return 'FULLY_QUALIFIED_REFERENCE';
    }

    // R-PHP5 DECLARING_CLASS: K es la declaración de la clase, interfaz, trait o enum C(A).
    if (
      anchorClass !== null &&
      PHP_TYPE_KINDS.has(chunk.symbolKind) &&
      chunk.symbolName === anchorClass
    ) {
      return 'DECLARING_CLASS';
    }

    return null;
  }

  /**
   * Relaciones estructurales V1 TypeScript (principalmente imports), resueltas por chunk:
   * IMPORTS = el chunk destino es referenciado por un import usado dentro del
   * propio chunk target; IMPORTED_BY = el chunk destino referencia, dentro de
   * su propio contenido, un import que resuelve al archivo del target.
   */
  private resolveStructuralMatches(
    anchor: CodeChunk,
    allChunks: CodeChunk[],
  ): Array<{ chunk: CodeChunk; relation: StructuralMatch }> {
    const importedFiles = new Set(
      anchor.importsUsed
        .map((specifier) => resolveRelativeImport(anchor.filePath, specifier))
        .filter((path): path is string => path !== null),
    );
    const anchorFile = stripExtension(anchor.filePath);
    const matches: Array<{ chunk: CodeChunk; relation: StructuralMatch }> = [];

    for (const chunk of allChunks) {
      if (isSameSymbol(chunk, anchor)) {
        continue;
      }

      if (importedFiles.has(stripExtension(chunk.filePath))) {
        matches.push({ chunk, relation: 'IMPORTS' });
        continue;
      }

      const referencesAnchorFile = chunk.importsUsed.some(
        (specifier) => resolveRelativeImport(chunk.filePath, specifier) === anchorFile,
      );

      if (referencesAnchorFile) {
        matches.push({ chunk, relation: 'IMPORTED_BY' });
      }
    }

    return matches;
  }
}
