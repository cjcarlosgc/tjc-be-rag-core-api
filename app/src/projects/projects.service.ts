import { HttpStatus, Injectable } from '@nestjs/common';
import { ProjectsRepository } from './projects.repository.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ProjectResponse } from './dto/project.response.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Project } from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';

const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class ProjectsService {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async create(dto: CreateProjectDto, ownerUserId: string): Promise<ProjectResponse> {
    const project = await this.projectsRepository.create(dto.name.trim(), ownerUserId);
    return this.toResponse(project);
  }

  async getById(id: string, ownerUserId: string): Promise<ProjectResponse> {
    const project = await this.projectsRepository.findById(id, ownerUserId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toResponse(project);
  }

  async list(
    limit: number | undefined,
    cursor: string | undefined,
    ownerUserId: string,
  ): Promise<Page<ProjectResponse>> {
    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const projects = await this.projectsRepository.findAll(take, ownerUserId, cursor);
    const hasMore = projects.length > take;
    const items = (hasMore ? projects.slice(0, take) : projects).map((project) =>
      this.toResponse(project),
    );

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  private toResponse(project: Project): ProjectResponse {
    return {
      id: project.id,
      name: project.name,
      currentVersionId: project.currentVersionId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
