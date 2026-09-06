import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Artifact } from '../generated/prisma/client.js';

export interface ArtifactToPersist {
  relativePath: string;
  artifactType: 'CREATED' | 'MODIFIED';
  storageKey: string;
  valid: boolean;
}

@Injectable()
export class ArtifactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertMany(testRunId: string, artifacts: ArtifactToPersist[]): Promise<void> {
    if (artifacts.length === 0) {
      return;
    }

    await this.prisma.artifact.createMany({
      data: artifacts.map((artifact) => ({ testRunId, ...artifact })),
    });
  }

  findByTestRun(testRunId: string): Promise<Artifact[]> {
    return this.prisma.artifact.findMany({
      where: { testRunId },
      orderBy: { relativePath: 'asc' },
    });
  }

  findById(id: string): Promise<Artifact | null> {
    return this.prisma.artifact.findUnique({ where: { id } });
  }

  findByTestRunAndPath(testRunId: string, relativePath: string): Promise<Artifact | null> {
    return this.prisma.artifact.findFirst({ where: { testRunId, relativePath } });
  }

  update(id: string, data: Partial<ArtifactToPersist>): Promise<Artifact> {
    return this.prisma.artifact.update({ where: { id }, data });
  }
}
