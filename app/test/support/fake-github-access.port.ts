import type {
  GithubAccessPort,
  GithubLookup,
  OrganizationInstallation,
  OrganizationMembership,
  OrganizationOwner,
  OrganizationRef,
  RepositoryOwner,
  RepositoryPermissionLevel,
  RepositoryRef,
} from '../../src/github-app/github-access.port.js';

export type FakeGithubMode = 'NORMAL' | 'UNVERIFIABLE' | 'NOT_INSTALLED';

export interface FakeGithubCall {
  method:
    | 'getRepositoryOwner'
    | 'getRepositoryPermission'
    | 'listOrganizationInstallations'
    | 'getOrganizationMembership'
    | 'listOrganizationOwners';
  repositoryName?: string;
  organizationLogin?: string;
  githubUserId?: string;
}

/**
 * Fake de `GithubAccessPort`: ningún test llama a GitHub real. Permite fijar por
 * repositorio su propietario y por (repositorio, usuario) el permiso (`role_name`
 * ya normalizado); un usuario sin permiso fijado no tiene ninguno (`NOT_FOUND`).
 * `ownerMode`/`permissionMode` fuerzan `UNVERIFIABLE` o `NOT_INSTALLED`.
 *
 * Lado de organización (corte 2): `addOrganization` registra una instalación de
 * la App, `setMembership` fija por (organización, usuario) el rol y estado
 * (`active`/`pending`; sin fijar = no es miembro, `NOT_FOUND`) y `setOwners` los
 * owners. Como GitHub, un owner activo de la organización tiene permiso efectivo `admin`
 * sobre los repositorios de la organización aunque no sea colaborador explícito
 * (`ownersHaveEffectiveAdmin`, activo por defecto; un permiso fijado con `setPermission`
 * prevalece). `installationsMode` fuerza `UNVERIFIABLE` a la lista de instalaciones y
 * `setOrganizationMode` a una sola organización (p. ej. `Members: read` sin
 * aceptar = `UNVERIFIABLE`, App desinstalada = `NOT_INSTALLED`).
 */
export class FakeGithubAccessPort implements GithubAccessPort {
  readonly calls: FakeGithubCall[] = [];
  ownerMode: FakeGithubMode = 'NORMAL';
  permissionMode: FakeGithubMode = 'NORMAL';
  installationsMode: FakeGithubMode = 'NORMAL';
  ownersHaveEffectiveAdmin = true;
  private readonly organizations = new Map<string, OrganizationInstallation>();
  private readonly organizationModes = new Map<string, FakeGithubMode>();
  private readonly memberships = new Map<string, OrganizationMembership>();
  private readonly owners = new Map<string, OrganizationOwner[]>();
  private readonly repositories = new Map<string, RepositoryOwner>();
  private readonly permissions = new Map<string, RepositoryPermissionLevel>();

  /** Vuelve al estado inicial (para reutilizar una misma instancia inyectada entre tests). */
  reset(): void {
    this.calls.length = 0;
    this.ownerMode = 'NORMAL';
    this.permissionMode = 'NORMAL';
    this.installationsMode = 'NORMAL';
    this.ownersHaveEffectiveAdmin = true;
    this.organizations.clear();
    this.organizationModes.clear();
    this.memberships.clear();
    this.owners.clear();
    this.repositories.clear();
    this.permissions.clear();
  }

  addOrganization(installation: OrganizationInstallation): this {
    this.organizations.set(installation.organizationLogin, installation);
    return this;
  }

  removeOrganization(organizationLogin: string): void {
    this.organizations.delete(organizationLogin);
  }

  setOrganizationMode(organizationLogin: string, mode: FakeGithubMode): this {
    this.organizationModes.set(organizationLogin, mode);
    return this;
  }

  setMembership(organizationLogin: string, githubUserId: string, membership: OrganizationMembership): this {
    this.memberships.set(`${organizationLogin}|${githubUserId}`, membership);
    return this;
  }

  setOwners(organizationLogin: string, owners: OrganizationOwner[]): this {
    this.owners.set(organizationLogin, owners);
    return this;
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

    const level = this.permissions.get(`${repository.repositoryName}|${githubUserId}`) ?? this.effectiveOwnerPermission(repository.repositoryName, githubUserId);
    return Promise.resolve(level ? { status: 'OK', value: level } : { status: 'NOT_FOUND' });
  }

  /** GitHub: un owner activo de la organización es `admin` de todos sus repositorios. */
  private effectiveOwnerPermission(repositoryName: string, githubUserId: string): RepositoryPermissionLevel | undefined {
    const owner = this.repositories.get(repositoryName);
    const membership = owner ? this.memberships.get(`${owner.ownerLogin}|${githubUserId}`) : undefined;

    return this.ownersHaveEffectiveAdmin && owner?.ownerType === 'Organization' && membership?.role === 'admin' && membership.state === 'active'
      ? 'admin'
      : undefined;
  }

  listOrganizationInstallations(): Promise<GithubLookup<OrganizationInstallation[]>> {
    this.calls.push({ method: 'listOrganizationInstallations' });

    if (this.installationsMode !== 'NORMAL') {
      return Promise.resolve({ status: 'UNVERIFIABLE' });
    }

    return Promise.resolve({ status: 'OK', value: [...this.organizations.values()] });
  }

  getOrganizationMembership(
    organization: OrganizationRef,
    githubUserId: string,
  ): Promise<GithubLookup<OrganizationMembership>> {
    this.calls.push({
      method: 'getOrganizationMembership',
      organizationLogin: organization.organizationLogin,
      githubUserId,
    });

    const mode = this.organizationModes.get(organization.organizationLogin) ?? 'NORMAL';

    if (mode !== 'NORMAL') {
      return Promise.resolve({ status: mode });
    }

    const membership = this.memberships.get(`${organization.organizationLogin}|${githubUserId}`);
    return Promise.resolve(membership ? { status: 'OK', value: membership } : { status: 'NOT_FOUND' });
  }

  listOrganizationOwners(organization: OrganizationRef): Promise<GithubLookup<OrganizationOwner[]>> {
    this.calls.push({ method: 'listOrganizationOwners', organizationLogin: organization.organizationLogin });

    const mode = this.organizationModes.get(organization.organizationLogin) ?? 'NORMAL';

    if (mode !== 'NORMAL') {
      return Promise.resolve({ status: mode });
    }

    return Promise.resolve({ status: 'OK', value: this.owners.get(organization.organizationLogin) ?? [] });
  }
}
