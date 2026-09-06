import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { TestTarget } from '../../generated/prisma/client.js';
import type { ResolvedTestTarget } from '../inventory/existing-test-resolver.service.js';

@Injectable()
export class TestTargetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deleteByProjectVersion(projectVersionId: string): Promise<void> {
    await this.prisma.testTarget.deleteMany({ where: { projectVersionId } });
  }

  async insertMany(projectVersionId: string, targets: ResolvedTestTarget[]): Promise<void> {
    if (targets.length === 0) {
      return;
    }

    await this.prisma.testTarget.createMany({
      data: targets.map((target) => ({
        projectVersionId,
        filePath: target.filePath,
        symbolName: target.symbolName,
        methodName: target.methodName,
        targetType: target.targetType,
        startLine: target.startLine,
        endLine: target.endLine,
        hasTest: target.hasTest,
        testFilePaths: target.testFilePaths,
      })),
    });
  }

  findByProjectVersion(projectVersionId: string): Promise<TestTarget[]> {
    return this.prisma.testTarget.findMany({
      where: { projectVersionId },
      orderBy: [{ filePath: 'asc' }, { symbolName: 'asc' }, { methodName: 'asc' }],
    });
  }
}
