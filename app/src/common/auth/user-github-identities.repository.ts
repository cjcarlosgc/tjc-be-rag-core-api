import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UserGithubIdentity } from '../../generated/prisma/client.js';

@Injectable()
export class UserGithubIdentitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<UserGithubIdentity | null> {
    return this.prisma.userGithubIdentity.findUnique({ where: { userId } });
  }

  /** Vínculo de un `githubUserId` (único): el usuario de Core al que un evento de GitHub se refiere, si existe. */
  findByGithubUserId(githubUserId: string): Promise<UserGithubIdentity | null> {
    return this.prisma.userGithubIdentity.findUnique({ where: { githubUserId } });
  }

  findByUserIds(userIds: string[]): Promise<UserGithubIdentity[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.userGithubIdentity.findMany({ where: { userId: { in: userIds } } });
  }

  /** `githubUserId` es único e inmutable: solo se inserta, nunca se actualiza. */
  create(userId: string, githubUserId: string, githubLogin: string | null): Promise<UserGithubIdentity> {
    return this.prisma.userGithubIdentity.create({ data: { userId, githubUserId, githubLogin } });
  }
}
