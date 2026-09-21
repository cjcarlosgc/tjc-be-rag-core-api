import type {
  GithubAccessPort,
  GithubLookup,
  RepositoryOwner,
  RepositoryPermissionLevel,
  RepositoryRef,
} from '../../src/github-app/github-access.port.js';

export type FakeGithubMode = 'NORMAL' | 'UNVERIFIABLE' | 'NOT_INSTALLED';

export interface FakeGithubCall {
  method: 'getRepositoryOwner' | 'getRepositoryPermission';
  repositoryName: string;
  githubUserId?: string;
}

/**
 * Fake de `GithubAccessPort`: ningún test llama a GitHub real. Permite fijar por
 * repositorio su propietario y por (repositorio, usuario) el permiso (`role_name`
 * ya normalizado); un usuario sin permiso fijado no tiene ninguno (`NOT_FOUND`).
 * `ownerMode`/`permissionMode` fuerzan `UNVERIFIABLE` o `NOT_INSTALLED`.
 */
export class FakeGithubAccessPort implements GithubAccessPort {
  readonly calls: FakeGithubCall[] = [];
  ownerMode: FakeGithubMode = 'NORMAL';
  permissionMode: FakeGithubMode = 'NORMAL';
  private readonly repositories = new Map<string, RepositoryOwner>();
  private readonly permissions = new Map<string, RepositoryPermissionLevel>();

  /** Vuelve al estado inicial (para reutilizar una misma instancia inyectada entre tests). */
  reset(): void {
    this.calls.length = 0;
    this.ownerMode = 'NORMAL';
    this.permissionMode = 'NORMAL';
    this.repositories.clear();
    this.permissions.clear();
  }

  addRepository(repositoryName: string, owner: RepositoryOwner): this {
    this.repositories.set(repositoryName, owner);
    return this;
  }

  removeRepository(repositoryName: string): void {
    this.repositories.delete(repositoryName);
  }

  setPermission(repositoryName: string, githubUserId: string, level: RepositoryPermissionLevel): this {
    this.permissions.set(`${repositoryName}|${githubUserId}`, level);
    return this;
  }

  getRepositoryOwner(repository: RepositoryRef): Promise<GithubLookup<RepositoryOwner>> {
    this.calls.push({ method: 'getRepositoryOwner', repositoryName: repository.repositoryName });

    if (this.ownerMode !== 'NORMAL') {
      return Promise.resolve({ status: this.ownerMode });
    }

    const owner = this.repositories.get(repository.repositoryName);
    return Promise.resolve(owner ? { status: 'OK', value: owner } : { status: 'NOT_FOUND' });
  }

  getRepositoryPermission(
    repository: RepositoryRef,
    githubUserId: string,
  ): Promise<GithubLookup<RepositoryPermissionLevel>> {
    this.calls.push({
      method: 'getRepositoryPermission',
      repositoryName: repository.repositoryName,
      githubUserId,
    });

    if (this.permissionMode !== 'NORMAL') {
      return Promise.resolve({ status: this.permissionMode });
    }

    const level = this.permissions.get(`${repository.repositoryName}|${githubUserId}`);
    return Promise.resolve(level ? { status: 'OK', value: level } : { status: 'NOT_FOUND' });
  }
}
