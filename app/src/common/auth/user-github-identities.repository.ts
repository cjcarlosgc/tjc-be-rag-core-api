import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UserGithubIdentity } from '../../generated/prisma/client.js';

@Injectable()
export class UserGithubIdentitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<UserGithubIdentity | null> {
    return this.prisma.userGithubIdentity.findUnique({ where: { userId } });
  }

  /** `githubUserId` es único e inmutable: solo se inserta, nunca se actualiza. */
  create(userId: string, githubUserId: string, githubLogin: string | null): Promise<UserGithubIdentity> {
    return this.prisma.userGithubIdentity.create({ data: { userId, githubUserId, githubLogin } });
  }
}
