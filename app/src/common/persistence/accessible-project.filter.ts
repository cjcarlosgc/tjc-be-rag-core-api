import type { Prisma, ProjectRole } from '../../generated/prisma/client.js';

/** Jerarquía `ADMIN` ⊃ `MAINTAINER` ⊃ `READER` (`INTEROP-2.4` §6.13). */
const ROLE_RANK: Record<ProjectRole, number> = { READER: 1, MAINTAINER: 2, ADMIN: 3 };

/** Roles que satisfacen `minRole`, del menor al mayor: un rol mayor también cumple. */
export function rolesAtLeast(minRole: ProjectRole): ProjectRole[] {
  return (Object.keys(ROLE_RANK) as ProjectRole[])
    .filter((role) => ROLE_RANK[role] >= ROLE_RANK[minRole])
    .sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
}

export function isRoleAtLeast(role: ProjectRole, minRole: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/**
 * Filtro `where` de un Project visible para `userId` con al menos `minRole`
 * (`014/plan.md`, "Predicado de acceso"; sustituye a `ownedProject`). Todo acceso
 * user-scoped debe pasar por aquí, en la consulta y no cargando y comparando, para
 * que un Project borrado lógicamente (HU56) o no visible se comporte como inexistente.
 *
 * Tres ramas:
 * 1. Project personal (`githubOrgId` nulo): solo su creador, siempre `ADMIN`, sin
 *    registro de acceso ni GitHub. Los Projects personales no se comparten.
 * 2. Project de organización con registro `ADMIN`: visible aunque su binding esté
 *    `REVOKED` (el Admin lo reactiva o lo elimina) o no exista (un Project sin
 *    repositorio solo lo ven los Admin).
 * 3. Project de organización con registro Maintainer/Reader suficiente Y un binding que
 *    EXISTE y no está `REVOKED`: un Project sin repositorio o con binding `REVOKED` lo ve
 *    solo un Admin (`INTEROP-2.4` §6.13). La regla se evalúa en cada petición, sin
 *    depender de que el paso a `REVOKED` haya borrado registros (eso lo hace el corte 5b)
 *    ni de que un Maintainer/Reader tenga registro solo porque el Project tuvo repositorio.
 */
export function accessibleProject(userId: string, minRole: ProjectRole = 'READER'): Prisma.ProjectWhereInput {
  return {
    deletedAt: null,
    OR: [
      { githubOrgId: null, ownerUserId: userId },
      { githubOrgId: { not: null }, access: { some: { userId, role: 'ADMIN' } } },
      {
        githubOrgId: { not: null },
        access: { some: { userId, role: { in: rolesAtLeast(minRole) } } },
        repositoryBinding: { is: { status: { not: 'REVOKED' } } },
      },
    ],
  };
}
