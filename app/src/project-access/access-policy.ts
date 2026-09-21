import { SetMetadata } from '@nestjs/common';
import type { ProjectRole } from '../generated/prisma/client.js';
import type { ProjectResourceKind } from './project-access.errors.js';

/** Metadatos de la política de acceso de cada ruta (`INTEROP-2.4` §6.13, default-deny). */
export const ACCESS_POLICY_KEY = 'access:policy';
export const WS_HANDSHAKE_KEY = 'access:ws-handshake';

/**
 * De dónde sale el recurso al que se aplica el rol mínimo:
 * - `param` / `query` / `body`: el id del recurso (un Project o un recurso descendiente que
 *   se resuelve a su Project para el alta por deep link).
 * - `optional`: la ausencia del id significa "sin recurso" (p. ej. `GET /action-required`).
 * - `listing`: la ruta no apunta a un recurso; devuelve solo lo visible con el rol mínimo
 *   por el predicado `accessibleProject` (p. ej. `GET /projects`).
 */
export type ProjectTarget =
  | { from: 'param' | 'query' | 'body'; name: string; resource: ProjectResourceKind; optional?: boolean }
  | { from: 'listing' };

export type AccessPolicy =
  | { kind: 'ROLE'; minRole: ProjectRole; target: ProjectTarget }
  | { kind: 'NONE'; reason: string };

export const ProjectTargets = {
  /** `:name` es el id de un Project. */
  project: (name: string): ProjectTarget => ({ from: 'param', name, resource: 'project' }),
  /** `:name` es el id de un recurso descendiente de un Project. */
  param: (resource: ProjectResourceKind, name: string): ProjectTarget => ({ from: 'param', name, resource }),
  /** Campo del body con el id del recurso (validado después por el DTO). */
  body: (resource: ProjectResourceKind, name: string): ProjectTarget => ({ from: 'body', name, resource }),
  /** Query param opcional con el id de un Project; ausente = listado de lo visible. */
  optionalQueryProject: (name: string): ProjectTarget => ({ from: 'query', name, resource: 'project', optional: true }),
  /** Sin recurso: el listado ya filtra por el predicado de visibilidad. */
  listing: (): ProjectTarget => ({ from: 'listing' }),
} as const;

/**
 * Rol mínimo sobre el Project del recurso (un rol mayor también satisface). Un Project no
 * visible responde `404` antes de evaluar el rol; visible con rol menor, `403
 * PROJECT_ROLE_INSUFFICIENT`. La aplica `ProjectRoleGuard`.
 */
export const RequireProjectRole = (minRole: ProjectRole, target: ProjectTarget): MethodDecorator =>
  SetMetadata<string, AccessPolicy>(ACCESS_POLICY_KEY, { kind: 'ROLE', minRole, target });

/**
 * Excepción explícita y motivada al rol de Project: la ruta exige solo sesión GitHub válida
 * (la columna "Sin rol de Project" de la matriz). El motivo es obligatorio.
 */
export const NoProjectRole = (reason: string): MethodDecorator => {
  if (reason.trim().length === 0) {
    throw new Error('@NoProjectRole exige un motivo.');
  }
  return SetMetadata<string, AccessPolicy>(ACCESS_POLICY_KEY, { kind: 'NONE', reason });
};

/**
 * Declara el método que autentica el handshake WebSocket (`io.use()`): es el equivalente
 * WebSocket de una ruta y entra en la enumeración default-deny con su motivo.
 */
export const WsHandshakeAccess = (reason: string): MethodDecorator => (target, key, descriptor) => {
  NoProjectRole(reason)(target, key, descriptor);
  Reflect.defineMetadata(WS_HANDSHAKE_KEY, true, descriptor.value as object);
};
