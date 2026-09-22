import type { UserGithubIdentity } from '../../src/generated/prisma/client.js';

/** Sustituto en memoria de `UserGithubIdentitiesRepository` (mismo contrato, incluida la unicidad). */
export class InMemoryUserGithubIdentitiesRepository {
  readonly rows = new Map<string, UserGithubIdentity>();

  findByUserId(userId: string): Promise<UserGithubIdentity | null> {
    return Promise.resolve(this.rows.get(userId) ?? null);
  }

  findByGithubUserId(githubUserId: string): Promise<UserGithubIdentity | null> {
    return Promise.resolve([...this.rows.values()].find((row) => row.githubUserId === githubUserId) ?? null);
  }

  findByUserIds(userIds: string[]): Promise<UserGithubIdentity[]> {
    return Promise.resolve(userIds.flatMap((userId) => this.rows.get(userId) ?? []));
  }

  create(userId: string, githubUserId: string, githubLogin: string | null): Promise<UserGithubIdentity> {
    const githubIdTaken = [...this.rows.values()].some((row) => row.githubUserId === githubUserId);
    if (this.rows.has(userId) || githubIdTaken) {
      return Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    }
    const now = new Date();
    const row: UserGithubIdentity = { userId, githubUserId, githubLogin, createdAt: now, updatedAt: now };
    this.rows.set(userId, row);
    return Promise.resolve(row);
  }
}
