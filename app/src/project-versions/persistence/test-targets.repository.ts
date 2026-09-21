import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { TestTarget } from '../../generated/prisma/client.js';
import type { ResolvedTestTarget } from '../inventory/existing-test-resolver.service.js';
import { accessibleProject } from '../../common/persistence/accessible-project.filter.js';

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

  /**
   * Sin scoping por propietario: uso exclusivo de job handlers en segundo
   * plano y de lecturas internas encadenadas a un recurso ya autorizado.
   */
  findById(id: string): Promise<TestTarget | null> {
    return this.prisma.testTarget.findUnique({ where: { id } });
  }

  /**
   * Variante para rutas HTTP: filtra por propietario en la misma consulta
   * (HU29) en vez de cargar y comprobar después.
   */
  findByIdForOwner(id: string, userId: string, projectId?: string): Promise<TestTarget | null> {
    return this.prisma.testTarget.findFirst({
      where: {
        id,
        // Con `projectId` el target debe pertenecer a ESE Project (no basta con verlo en otro).
        projectVersion: { ...(projectId === undefined ? {} : { projectId }), project: accessibleProject(userId) },
      },
    });
  }

  findMethodsOfClass(projectVersionId: string, className: string): Promise<TestTarget[]> {
    return this.prisma.testTarget.findMany({
      where: { projectVersionId, symbolName: className, targetType: 'METHOD' },
      orderBy: [{ filePath: 'asc' }, { methodName: 'asc' }],
    });
  }

  findTestableTargets(projectVersionId: string): Promise<TestTarget[]> {
    return this.prisma.testTarget.findMany({
      where: { projectVersionId, targetType: { in: ['METHOD', 'FUNCTION'] } },
      orderBy: [{ filePath: 'asc' }, { symbolName: 'asc' }, { methodName: 'asc' }],
    });
  }
}
