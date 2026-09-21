import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { ProjectRole } from '../generated/prisma/client.js';

/** Un Project no visible responde el mismo `404` que uno inexistente, borrado o ajeno. */
export function projectNotFound(projectId: string): AppException {
  return new AppException(
    ErrorCode.PROJECT_NOT_FOUND,
    `No existe un proyecto con id "${projectId}".`,
    HttpStatus.NOT_FOUND,
  );
}

/** Project visible con un rol menor al mínimo de la operación (`INTEROP-2.4` §6.13). */
export function projectRoleInsufficient(requiredRole: ProjectRole, currentRole: ProjectRole): AppException {
  return new AppException(
    ErrorCode.PROJECT_ROLE_INSUFFICIENT,
    `La operación requiere el rol ${requiredRole} sobre el proyecto.`,
    HttpStatus.FORBIDDEN,
    { requiredRole, currentRole },
  );
}

/** GitHub no permite verificar un acceso nuevo: nunca `404` ni `500`; el usuario reintenta. */
export function githubVerificationUnavailable(): AppException {
  return new AppException(
    ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
    'GitHub no permite verificar el acceso en este momento; reintenta.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

export function workspaceNotFound(workspaceId: string): AppException {
  return new AppException(
    ErrorCode.WORKSPACE_NOT_FOUND,
    `No existe un workspace con id "${workspaceId}".`,
    HttpStatus.NOT_FOUND,
  );
}

export function workspaceAdminRequired(): AppException {
  return new AppException(
    ErrorCode.WORKSPACE_ADMIN_REQUIRED,
    'Solo un owner de la organización puede crear proyectos en ella.',
    HttpStatus.FORBIDDEN,
  );
}
