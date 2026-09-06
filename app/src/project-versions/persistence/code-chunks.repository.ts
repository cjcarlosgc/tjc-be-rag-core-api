import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CodeChunk } from '../../generated/prisma/client.js';
import type { ParsedChunk } from '../parsing/typescript-parser.service.js';

export interface ChunkToPersist extends ParsedChunk {
  embedding: number[];
}

export interface SimilarChunk extends CodeChunk {
  semanticScore: number;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => value.toFixed(8)).join(',')}]`;
}

@Injectable()
export class CodeChunksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deleteByProjectVersion(projectVersionId: string): Promise<void> {
    await this.prisma.codeChunk.deleteMany({ where: { projectVersionId } });
  }

  async insertMany(projectVersionId: string, chunks: ChunkToPersist[]): Promise<void> {
    for (const chunk of chunks) {
      await this.prisma.$executeRaw`
        INSERT INTO "code_chunks"
          (id, "projectVersionId", "filePath", "symbolKind", "symbolName", "parentSymbolName", "startLine", "endLine", "content", "importsUsed", "tokenCount", "partIndex", "partsTotal", "embedding", "createdAt")
        VALUES
          (${randomUUID()}, ${projectVersionId}, ${chunk.filePath}, ${chunk.symbolKind}, ${chunk.symbolName}, ${chunk.parentSymbolName}, ${chunk.startLine}, ${chunk.endLine}, ${chunk.content}, ${chunk.importsUsed}, ${chunk.tokenCount}, ${chunk.partIndex}, ${chunk.partsTotal}, ${toVectorLiteral(chunk.embedding)}::vector, now());
      `;
    }
  }

  findByProjectVersion(projectVersionId: string): Promise<CodeChunk[]> {
    return this.prisma.codeChunk.findMany({ where: { projectVersionId } });
  }

  findBySymbol(
    projectVersionId: string,
    filePath: string,
    symbolKind: string,
    symbolName: string,
    parentSymbolName: string | null,
  ): Promise<CodeChunk[]> {
    return this.prisma.codeChunk.findMany({
      where: { projectVersionId, filePath, symbolKind, symbolName, parentSymbolName },
      orderBy: { partIndex: 'asc' },
    });
  }

  /**
   * Similitud coseno de pgvector (`<=>`) contra el embedding de un chunk ancla,
   * excluyendo ese mismo chunk y cualquier parte hermana de un mismo símbolo
   * oversized (mismo filePath/symbolKind/symbolName/parentSymbolName).
   */
  async findSimilarByEmbedding(
    projectVersionId: string,
    anchorChunkId: string,
    limit: number,
  ): Promise<SimilarChunk[]> {
    return this.prisma.$queryRaw<SimilarChunk[]>`
      SELECT
        c.id, c."projectVersionId", c."filePath", c."symbolKind", c."symbolName", c."parentSymbolName",
        c."startLine", c."endLine", c."content", c."importsUsed", c."tokenCount", c."partIndex",
        c."partsTotal", c."createdAt",
        (1 - (c."embedding" <=> a."embedding"))::float8 AS "semanticScore"
      FROM "code_chunks" c, (SELECT "embedding" FROM "code_chunks" WHERE id = ${anchorChunkId}) a
      WHERE c."projectVersionId" = ${projectVersionId}
        AND c."embedding" IS NOT NULL
        AND NOT (
          c."filePath" = (SELECT "filePath" FROM "code_chunks" WHERE id = ${anchorChunkId})
          AND c."symbolKind" = (SELECT "symbolKind" FROM "code_chunks" WHERE id = ${anchorChunkId})
          AND c."symbolName" IS NOT DISTINCT FROM (SELECT "symbolName" FROM "code_chunks" WHERE id = ${anchorChunkId})
          AND c."parentSymbolName" IS NOT DISTINCT FROM (SELECT "parentSymbolName" FROM "code_chunks" WHERE id = ${anchorChunkId})
        )
      ORDER BY c."embedding" <=> a."embedding"
      LIMIT ${limit};
    `;
  }
}
