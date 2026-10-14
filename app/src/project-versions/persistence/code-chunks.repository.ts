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

/** Campos mínimos para resolver dependencias PHP sin cargar embeddings. */
export type CodeChunkDependencyFields = Pick<
  CodeChunk,
  'filePath' | 'symbolKind' | 'symbolName' | 'parentSymbolName' | 'importsUsed' | 'content'
>;

const PHP_TYPE_SYMBOL_KINDS = ['CLASS', 'INTERFACE', 'TRAIT', 'ENUM'];

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

  /**
   * Chunks de un símbolo. `symbolKind` acepta una lista (p. ej. `['METHOD', 'CONSTRUCTOR']`) que se
   * traduce a `IN`; con un string se mantiene la igualdad.
   */
  findBySymbol(
    projectVersionId: string,
    filePath: string,
    symbolKind: string | readonly string[],
    symbolName: string,
    parentSymbolName: string | null,
  ): Promise<CodeChunk[]> {
    const kindFilter = typeof symbolKind === 'string' ? symbolKind : { in: [...symbolKind] };
    return this.prisma.codeChunk.findMany({
      where: { projectVersionId, filePath, symbolKind: kindFilter, symbolName, parentSymbolName },
      orderBy: { partIndex: 'asc' },
    });
  }

  findByFile(projectVersionId: string, filePath: string): Promise<CodeChunkDependencyFields[]> {
    return this.prisma.codeChunk.findMany({
      where: { projectVersionId, filePath },
      select: {
        filePath: true,
        symbolKind: true,
        symbolName: true,
        parentSymbolName: true,
        importsUsed: true,
        content: true,
      },
      orderBy: { partIndex: 'asc' },
    });
  }

  /** Nombres (FQCN) únicos de los tipos PHP de la versión. */
  async findPhpTypeSymbolNames(projectVersionId: string): Promise<string[]> {
    const rows = await this.prisma.codeChunk.findMany({
      where: {
        projectVersionId,
        symbolKind: { in: PHP_TYPE_SYMBOL_KINDS },
        filePath: { endsWith: '.php' },
      },
      select: { symbolName: true },
    });
    const names = new Set<string>();
    for (const row of rows) {
      if (row.symbolName !== null) names.add(row.symbolName);
    }
    return [...names];
  }

  /**
   * WI-CORE-058: declaración PHP (CLASS, ENUM, INTERFACE, TRAIT) de cada FQCN pedido, solo si es única.
   * Solo se consulta la parte 1 de cada chunk (contiene los modificadores de la declaración). Un FQCN con
   * más de una declaración (mismo nombre en archivos distintos, o CLASS e INTERFACE/TRAIT del mismo nombre)
   * es ambiguo y se omite: no se devuelve. Orden determinista (symbolName, filePath, partIndex).
   */
  async findPhpTypeDeclarations(
    projectVersionId: string,
    symbolNames: string[],
  ): Promise<Array<{ symbolName: string; symbolKind: string; content: string }>> {
    if (symbolNames.length === 0) return [];
    const rows = await this.prisma.codeChunk.findMany({
      where: {
        projectVersionId,
        symbolKind: { in: PHP_TYPE_SYMBOL_KINDS },
        symbolName: { in: [...new Set(symbolNames)] },
        filePath: { endsWith: '.php' },
        partIndex: 1,
      },
      select: { symbolName: true, symbolKind: true, content: true, partIndex: true },
      orderBy: [{ symbolName: 'asc' }, { filePath: 'asc' }, { partIndex: 'asc' }],
    });
    const bySymbol = new Map<string, Array<{ symbolName: string; symbolKind: string; content: string }>>();
    for (const row of rows) {
      if (row.symbolName === null || row.partIndex !== 1) continue;
      const list = bySymbol.get(row.symbolName) ?? [];
      list.push({ symbolName: row.symbolName, symbolKind: row.symbolKind, content: row.content });
      bySymbol.set(row.symbolName, list);
    }
    const unique: Array<{ symbolName: string; symbolKind: string; content: string }> = [];
    for (const declarations of bySymbol.values()) {
      if (declarations.length === 1) unique.push(declarations[0]);
    }
    return unique;
  }

  /**
   * WI-CORE-065: content de la parte 1 del CONSTRUCTOR PHP de cada clase padre indicada. Un padre con
   * constructores en más de un archivo es ambiguo y se omite.
   */
  async findPhpConstructorDeclarations(
    projectVersionId: string,
    parentSymbolNames: string[],
  ): Promise<Array<{ parentSymbolName: string; content: string }>> {
    const names = [...new Set(parentSymbolNames)];
    if (names.length === 0) return [];
    const rows = await this.prisma.codeChunk.findMany({
      where: {
        projectVersionId,
        symbolKind: 'CONSTRUCTOR',
        parentSymbolName: { in: names },
        filePath: { endsWith: '.php' },
        partIndex: 1,
      },
      select: { parentSymbolName: true, filePath: true, content: true, partIndex: true },
      orderBy: [{ parentSymbolName: 'asc' }, { filePath: 'asc' }, { partIndex: 'asc' }],
    });
    const byParent = new Map<string, Array<{ parentSymbolName: string; content: string }>>();
    for (const row of rows) {
      if (row.parentSymbolName === null || row.partIndex !== 1) continue;
      const list = byParent.get(row.parentSymbolName) ?? [];
      list.push({ parentSymbolName: row.parentSymbolName, content: row.content });
      byParent.set(row.parentSymbolName, list);
    }
    const unique: Array<{ parentSymbolName: string; content: string }> = [];
    for (const constructors of byParent.values()) {
      if (constructors.length === 1) unique.push(constructors[0]);
    }
    return unique;
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
