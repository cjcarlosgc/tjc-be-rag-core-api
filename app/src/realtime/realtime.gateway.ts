import { HttpStatus } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { extractHandshakeToken } from '../common/auth/handshake-token.util.js';
import { SessionAuthService } from '../common/auth/session-auth.service.js';
import { InvalidTokenError } from '../common/auth/token-verifier.port.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { ProjectVersionResponse } from '../project-versions/dto/project-version.response.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';

function projectVersionRoom(projectVersionId: string): string {
  return `project-version:${projectVersionId}`;
}

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
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly sessionAuth: SessionAuthService,
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

  @SubscribeMessage('subscribe:project-version')
  async subscribeProjectVersion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectVersionId: string },
  ): Promise<void> {
    const owned = await this.projectVersionsRepository.findByIdForOwner(
      body.projectVersionId,
      client.data.userId as string,
    );

    if (owned) {
      void client.join(projectVersionRoom(body.projectVersionId));
    }
  }

  @SubscribeMessage('unsubscribe:project-version')
  unsubscribeProjectVersion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectVersionId: string },
  ): void {
    void client.leave(projectVersionRoom(body.projectVersionId));
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
