import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Project } from '../generated/prisma/client.js';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(name: string, ownerUserId: string): Promise<Project> {
    return this.prisma.project.create({ data: { name, ownerUserId } });
  }

  findById(id: string, ownerUserId: string): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { id, ownerUserId } });
  }

  /**
   * HU25: página de proyectos, más recientes primero. Se pide `take + 1`
   * para saber si hay una página siguiente sin una segunda consulta; el
   * cursor es el id del último proyecto devuelto.
   */
  findAll(take: number, ownerUserId: string, cursor?: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { ownerUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
