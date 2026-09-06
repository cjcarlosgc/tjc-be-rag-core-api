import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Project } from '../generated/prisma/client.js';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(name: string): Promise<Project> {
    return this.prisma.project.create({ data: { name } });
  }

  findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  /**
   * HU25: página de proyectos, más recientes primero. Se pide `take + 1`
   * para saber si hay una página siguiente sin una segunda consulta; el
   * cursor es el id del último proyecto devuelto.
   */
  findAll(take: number, cursor?: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
