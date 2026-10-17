import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/auth/auth.constants.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ACCESS_POLICY_KEY, type AccessPolicy } from './access-policy.js';
import { ProjectAccessService } from './project-access.service.js';

/**
 * Guard global default-deny de `INTEROP-2.4` §6.13 (se ejecuta después de `AuthGuard`).
 * Toda ruta autenticada declara su rol mínimo (`@RequireProjectRole`) o una excepción
 * motivada (`@NoProjectRole`); una ruta sin declaración se DENIEGA (nunca se permite por
 * omisión) y, además, `RouteAccessAuditor` impide arrancar con una. Resuelve el `projectId`
 * del recurso (el Project mismo o un descendiente, incluido un deep link) y aplica
 * `ProjectAccessService.requireForResource`: no visible `404` (el del recurso), rol menor
 * `403 PROJECT_ROLE_INSUFFICIENT`, acceso nuevo no verificable `503`.
 *
 * WebSocket: `subscribe:*` devuelve un `SubscribeAck` en vez de una excepción, así que el
 * `RealtimeGateway` aplica el rol Reader por sí mismo; aquí solo se exige la declaración.
 */
@Injectable()
export class ProjectRoleGuard implements CanActivate {
  private readonly logger = new Logger(ProjectRoleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, context.getClass()])) {
      return true;
    }

    const isWs = context.getType<'http' | 'ws'>() === 'ws';
    const policy = this.reflector.get<AccessPolicy | undefined>(ACCESS_POLICY_KEY, handler);

    if (!policy) {
      this.logger.error(
        `La ruta ${context.getClass().name}.${handler.name} no declara @RequireProjectRole ni @NoProjectRole: denegada.`,
      );
      throw isWs
        ? new WsException({ code: ErrorCode.INTERNAL_ERROR, message: 'Error interno del servidor.' })
        : new AppException(ErrorCode.INTERNAL_ERROR, 'Error interno del servidor.', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (policy.kind === 'NONE' || isWs || policy.target.from === 'listing') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!request.userId) {
      // El guard de autenticación debe haber corrido antes: fail-closed si no lo hizo.
      throw new AppException(ErrorCode.AUTH_REQUIRED, 'Falta un access token válido.', HttpStatus.UNAUTHORIZED);
    }

    const { target, minRole } = policy;
    const raw: unknown =
      target.from === 'param'
        ? request.params[target.name]
        : target.from === 'query'
          ? request.query[target.name]
          : (request.body as Record<string, unknown> | undefined)?.[target.name];

    if (typeof raw !== 'string' || raw.length === 0) {
      // Un id de ruta siempre existe. Ausente o malformado en query/body: lo rechaza la
      // validación del DTO (400) sin que exista un recurso que exponer; y el servicio
      // vuelve a exigir el rol sobre el Project con el mismo predicado.
      return true;
    }

    await this.projectAccess.requireForResource(request.userId, target.resource, raw, minRole);
    return true;
  }
}
