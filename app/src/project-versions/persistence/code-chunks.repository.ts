import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ParsedChunk } from '../parsing/typescript-parser.service.js';

export interface ChunkToPersist extends ParsedChunk {
  embedding: number[];
  tokenCount: number;
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
          (id, "projectVersionId", "filePath", "symbolKind", "symbolName", "startLine", "endLine", "content", "tokenCount", "embedding", "createdAt")
        VALUES
          (${randomUUID()}, ${projectVersionId}, ${chunk.filePath}, ${chunk.symbolKind}, ${chunk.symbolName}, ${chunk.startLine}, ${chunk.endLine}, ${chunk.content}, ${chunk.tokenCount}, ${toVectorLiteral(chunk.embedding)}::vector, now());
      `;
    }
  }
}
