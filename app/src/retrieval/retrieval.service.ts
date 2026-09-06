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
    vectorTopK = 20,
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
    const [semanticCandidates, allChunks] = await Promise.all([
      this.codeChunksRepository.findSimilarByEmbedding(projectVersionId, anchor.id, vectorTopK),
      this.codeChunksRepository.findByProjectVersion(projectVersionId),
    ]);

    const candidatesById = new Map<string, RetrievalCandidate>();

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

    for (const { chunk, relation } of this.resolveStructuralMatches(anchor, allChunks)) {
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
   * Relaciones estructurales V1 (principalmente imports), resueltas por chunk:
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
