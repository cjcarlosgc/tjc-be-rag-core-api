import { HttpStatus } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { extractHandshakeToken } from '../common/auth/handshake-token.util.js';
import { SessionAuthService } from '../common/auth/session-auth.service.js';
import { InvalidTokenError } from '../common/auth/token-verifier.port.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ProjectTargets, RequireProjectRole, NoProjectRole, WsHandshakeAccess } from '../project-access/access-policy.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import type { ProjectVersionResponse } from '../project-versions/dto/project-version.response.js';
import { ProjectSubscriptionsService, projectVersionRoom } from './project-subscriptions.service.js';

/**
 * Acknowledgment de `subscribe:project-version` (`INTEROP-2.4` §6.6) con exactamente tres
 * resultados: suscrito; verificación no disponible (rechazo reintentable); sin visibilidad,
 * sin distinguirlo de un id inexistente.
 */
export interface SubscribeAck {
  subscribed: boolean;
  code: 'GITHUB_VERIFICATION_UNAVAILABLE' | null;
  retryable: boolean;
}

const SUBSCRIBED: SubscribeAck = { subscribed: true, code: null, retryable: false };
const VERIFICATION_UNAVAILABLE: SubscribeAck = { subscribed: false, code: 'GITHUB_VERIFICATION_UNAVAILABLE', retryable: true };
const NOT_VISIBLE: SubscribeAck = { subscribed: false, code: null, retryable: false };

/**
 * HU21: complemento del endpoint de estado por polling, nunca un reemplazo.
 * Un cliente se suscribe a un id específico (sala por id); el servidor nunca
 * hace broadcast global. Contrato en
 * `spec/contracts/interoperability-contract.md` sección 6.6.
 *
 * Los eventos `*:test-run` (HU22) quedaron retirados junto con la generación
 * manual (ver CHANGELOG.md); vuelven, rediseñados sobre `AnalysisRun`, cuando
 * exista un equivalente PR-driven.
 */
@WebSocketGateway({ cors: true })
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly projectAccess: ProjectAccessService,
    private readonly subscriptions: ProjectSubscriptionsService,
  ) {}

  /**
   * HU62: el handshake resuelve la identidad con la misma vía que HTTP. Un
   * token presente que no se puede autenticar rechaza la conexión con
   * `err.data = { code, message, retryable }` (`INVALID_ACCESS_TOKEN`,
   * `GITHUB_IDENTITY_REQUIRED`, `IDENTITY_UNAVAILABLE`). Un rechazo de
   * middleware desactiva la reconexión automática del cliente: `retryable`
   * indica que reintentar con `connect()` manual tiene sentido. Sin token el
   * socket se acepta (la Console actual no envía `auth` y cae al polling) y el
   * guard de cada mensaje sigue exigiendo credencial.
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticateHandshake(socket).then(next);
    });
  }

  handleDisconnect(client: Socket): void {
    this.subscriptions.forget(client.id);
  }

  @WsHandshakeAccess(
    'El handshake solo autentica la identidad (mismo resolvedor que HTTP) y no expone recursos; el rol Reader se exige en cada subscribe.',
  )
  private async authenticateHandshake(socket: Socket): Promise<Error | undefined> {
    const token = extractHandshakeToken(socket.handshake);

    if (!token) {
      return undefined;
    }

    try {
      const identity = await this.sessionAuth.authenticate(token);
      socket.data.userId = identity.userId;
      socket.data.githubUserId = identity.githubUserId;
      return undefined;
    } catch (error) {
      return toHandshakeError(error);
    }
  }

  /**
   * Exige al menos rol Reader sobre el Project de la versión antes de unir el socket a la
   * sala (mismo `ProjectAccessService.requireForResource` que HTTP: alta por deep link,
   * predicado de visibilidad, sin fugas). Nunca lanza por falta de acceso: responde el
   * `SubscribeAck` del contrato.
   */
  @SubscribeMessage('subscribe:project-version')
  @RequireProjectRole('READER', ProjectTargets.body('projectVersion', 'projectVersionId'))
  async subscribeProjectVersion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectVersionId: string },
  ): Promise<SubscribeAck> {
    const projectVersionId = body?.projectVersionId;

    if (typeof projectVersionId !== 'string' || projectVersionId.length === 0) {
      return NOT_VISIBLE;
    }

    const userId = client.data.userId as string;

    try {
      const { project } = await this.projectAccess.requireForResource(userId, 'projectVersion', projectVersionId, 'READER');
      await client.join(projectVersionRoom(projectVersionId));
      this.subscriptions.track(client, userId, projectVersionId, project.id);
      return SUBSCRIBED;
    } catch (error) {
      if (error instanceof AppException) {
        if (error.code === ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE) {
          return VERIFICATION_UNAVAILABLE;
        }
        // 404 (versión inexistente o Project no visible): indistinguibles. Un Reader nunca da 403.
        if (error.getStatus() === HttpStatus.NOT_FOUND) {
          return NOT_VISIBLE;
        }
      }
      throw error;
    }
  }

  @SubscribeMessage('unsubscribe:project-version')
  @NoProjectRole('Solo abandona una sala propia del socket; no concede ni expone nada.')
  unsubscribeProjectVersion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectVersionId: string },
  ): void {
    void client.leave(projectVersionRoom(body.projectVersionId));
    this.subscriptions.untrack(client.id, body.projectVersionId);
  }

  emitProjectVersionUpdate(projectVersionId: string, payload: ProjectVersionResponse): void {
    this.server?.to(projectVersionRoom(projectVersionId)).emit('project-version:update', payload);
  }
}

function toHandshakeError(error: unknown): Error {
  if (error instanceof InvalidTokenError) {
    return handshakeError(ErrorCode.INVALID_ACCESS_TOKEN, 'El access token es inválido o expiró.', false);
  }
  if (error instanceof AppException) {
    return handshakeError(
      error.code,
      error.message,
      error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return handshakeError(ErrorCode.INTERNAL_ERROR, 'Error interno del servidor.', false);
}

function handshakeError(code: ErrorCode, message: string, retryable: boolean): Error {
  return Object.assign(new Error(code), { data: { code, message, retryable } });
}
