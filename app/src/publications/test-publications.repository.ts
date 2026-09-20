import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TestPublication, TestPublicationStatus } from '../generated/prisma/client.js';
import { ownedProject } from '../common/persistence/owned-project.filter.js';

export interface CreateTestPublicationInput {
  analysisRunId: string;
  proposalIds: string[];
  sourceHeadSha: string;
}

export interface UpdateTestPublicationInput {
  status?: TestPublicationStatus;
  branchName?: string;
  companionPullRequestNumber?: number;
  companionPullRequestUrl?: string;
  failureMessage?: string;
}

@Injectable()
export class TestPublicationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateTestPublicationInput): Promise<TestPublication> {
    return this.prisma.testPublication.create({ data: input });
  }

  findById(id: string): Promise<TestPublication | null> {
    return this.prisma.testPublication.findUnique({ where: { id } });
  }

  findByIdForOwner(id: string, ownerUserId: string): Promise<TestPublication | null> {
    return this.prisma.testPublication.findFirst({
      where: { id, analysisRun: { project: ownedProject(ownerUserId) } },
    });
  }

  update(id: string, patch: UpdateTestPublicationInput): Promise<TestPublication> {
    return this.prisma.testPublication.update({ where: { id }, data: patch });
  }
}
