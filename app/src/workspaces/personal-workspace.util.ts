import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

/**
 * Hasta el corte 3 el único workspace aceptado por una ruta con `workspaceId` es
 * el personal, cuyo id es el `githubUserId` de la sesión. Omitido = personal;
 * cualquier otro valor (organización, ajeno o inexistente) es indistinguible y
 * responde `404 WORKSPACE_NOT_FOUND`, sin consultar a GitHub.
 */
export function assertPersonalWorkspace(workspaceId: string | undefined, githubUserId: string): void {
  if (workspaceId !== undefined && workspaceId !== githubUserId) {
    throw new AppException(
      ErrorCode.WORKSPACE_NOT_FOUND,
      `No existe un workspace con id "${workspaceId}".`,
      HttpStatus.NOT_FOUND,
    );
  }
}
