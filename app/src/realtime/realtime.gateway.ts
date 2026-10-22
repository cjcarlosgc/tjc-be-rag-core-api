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
import type { ProjectResourceKind } from '../project-access/project-access.errors.js';
import type { ProjectVersionResponse } from '../project-versions/dto/project-version.response.js';
import { ProjectSubscriptionsService } from './project-subscriptions.service.js';
import { analysisRunRoom, experimentRoom, projectVersionRoom, type RealtimePublisher } from './realtime-publisher.port.js';
import { createConsoleCorsOrigin } from '../common/cors.js';

/**
 * Acknowledgment de las suscripciones (`INTEROP-2.18` §6.6) con exactamente tres resultados: suscrito; verificación
 * no disponible (rechazo reintentable); sin visibilidad, sin distinguirlo de un id inexistente.
 */
export interface SubscribeAck {
  subscribed: boolean;
  code: 'GITHUB_VERIFICATION_UNAVAILABLE' | null;
  retryable: boolean;
}

const SUBSCRIBED: SubscribeAck = { subscribed: true, code: null, retryable: false };
const VERIFICATION_UNAVAILABLE: SubscribeAck = { subscribed: false, code: 'GITHUB_VERIFICATION_UNAVAILABLE', retryable: true };
const NOT_VISIBLE: SubscribeAck = { subscribed: false, code: null, retryable: false };

/** Qué se registra para una suscripción: la sala, y cómo se registra el socket en el mapa socket -> Project. */
interface RoomSubscription {
  room: string;
  track(projectId: string): void;
  untrack(): void;
}

/**
 * Tiempo real complementario al polling HTTP (nunca un reemplazo). Un cliente se suscribe a un id concreto (sala por
 * id); el servidor nunca hace broadcast global. Contrato en `spec/contracts/interoperability-contract.md` §6.6.
 *
 * Implementa el puerto de publicación `RealtimePublisher`: los servicios de dominio emiten por el token, no por esta
 * clase.
 */
@WebSocketGateway({ cors: { origin: createConsoleCorsOrigin() } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect, RealtimePublisher {
  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly projectAccess: ProjectAccessService,
    private readonly subscriptions: ProjectSubscriptionsService,
  ) {}

  /**
   * El handshake resuelve la identidad con la misma vía que HTTP (`SessionAuthService`). Sin token o con un token que
   * no autentica, rechaza la conexión con `err.data = { code, message, retryable }`:
   * - `AUTH_REQUIRED` si falta el token (misma regla que el guard HTTP, también bajo `AUTH_BYPASS`);
   * - `INVALID_ACCESS_TOKEN` si el token es inválido o expiró;
   * - `GITHUB_IDENTITY_REQUIRED` / `IDENTITY_UNAVAILABLE` si la identidad GitHub no se resuelve.
   * Un rechazo de middleware desactiva la reconexión automática del cliente: `retryable` indica que reintentar con
   * `connect()` manual tiene sentido.
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticateHandshake(socket).then(next);
    });
  }

  handleDisconnect(client: Socket): void {
    this.subscriptions.forget(client.id);
  }

  /** Puerto `RealtimePublisher`: hay al menos un socket unido a la sala. */
  hasSubscribers(room: string): boolean {
    return (this.server?.sockets?.adapter?.rooms?.get(room)?.size ?? 0) > 0;
  }

  /** Puerto `RealtimePublisher`: emite solo a la sala indicada. Sin servidor adjunto no hace nada. */
  publish(room: string, event: string, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }

  @WsHandshakeAccess(
    'El handshake solo autentica la identidad (mismo resolvedor que HTTP) y no expone recursos; el rol Reader se exige en cada subscribe.',
  )
  private async authenticateHandshake(socket: Socket): Promise<Error | undefined> {
    const token = extractHandshakeToken(socket.handshake);

    if (!token) {
      return handshakeError(ErrorCode.AUTH_REQUIRED, 'Falta un access token válido.', false);
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
   * Exige al menos rol Reader sobre el Project de la versión antes de unir el socket a la sala (mismo
   * `ProjectAccessService.requireForResource` que HTTP: alta por deep link, predicado de visibilidad, sin fugas).
   * Nunca lanza por falta de acceso: responde el `SubscribeAck` del contrato.
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
    return this.subscribeResource(client, 'projectVersion', projectVersionId, {
      room: projectVersionRoom(projectVersionId),
      track: (projectId) => this.subscriptions.track(client, userId, projectVersionId, projectId),
      untrack: () => this.subscriptions.untrack(client.id, projectVersionId),
    });
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

  /** `subscribe:analysis-run` (D1): Reader sobre el Project del Run, mismo ack y mismo patrón que project-version. */
  @SubscribeMessage('subscribe:analysis-run')
  @RequireProjectRole('READER', ProjectTargets.body('analysisRun', 'analysisRunId'))
  async subscribeAnalysisRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { analysisRunId: string },
  ): Promise<SubscribeAck> {
    const analysisRunId = body?.analysisRunId;

    if (typeof analysisRunId !== 'string' || analysisRunId.length === 0) {
      return NOT_VISIBLE;
    }

    return this.subscribeResource(client, 'analysisRun', analysisRunId, this.resourceRoom(client, analysisRunRoom(analysisRunId)));
  }

  @SubscribeMessage('unsubscribe:analysis-run')
  @NoProjectRole('Solo abandona una sala propia del socket; no concede ni expone nada.')
  unsubscribeAnalysisRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { analysisRunId: string },
  ): void {
    void client.leave(analysisRunRoom(body.analysisRunId));
    this.subscriptions.untrackRoom(client.id, analysisRunRoom(body.analysisRunId));
  }

  /** `subscribe:experiment` (D1): Reader sobre el Project del experimento. */
  @SubscribeMessage('subscribe:experiment')
  @RequireProjectRole('READER', ProjectTargets.body('experiment', 'experimentId'))
  async subscribeExperiment(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { experimentId: string },
  ): Promise<SubscribeAck> {
    const experimentId = body?.experimentId;

    if (typeof experimentId !== 'string' || experimentId.length === 0) {
      return NOT_VISIBLE;
    }

    return this.subscribeResource(client, 'experiment', experimentId, this.resourceRoom(client, experimentRoom(experimentId)));
  }

  @SubscribeMessage('unsubscribe:experiment')
  @NoProjectRole('Solo abandona una sala propia del socket; no concede ni expone nada.')
  unsubscribeExperiment(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { experimentId: string },
  ): void {
    void client.leave(experimentRoom(body.experimentId));
    this.subscriptions.untrackRoom(client.id, experimentRoom(body.experimentId));
  }

  /** Compatibilidad: emisión de `project-version:update` a su sala (sin llamadores en producción todavía). */
  emitProjectVersionUpdate(projectVersionId: string, payload: ProjectVersionResponse): void {
    this.publish(projectVersionRoom(projectVersionId), 'project-version:update', payload);
  }

  private resourceRoom(client: Socket, room: string): RoomSubscription {
    const userId = client.data.userId as string;
    return {
      room,
      track: (projectId) => this.subscriptions.trackRoom(client, userId, room, projectId),
      untrack: () => this.subscriptions.untrackRoom(client.id, room),
    };
  }

  /**
   * Flujo común de las suscripciones (mismo orden que `subscribe:project-version`): verificar Reader vivo, registrar
   * ANTES de unir la sala, unir y revalidar DESPUÉS (una revocación que llegó entre medias ya corrió sin ver al socket).
   * Un recurso inexistente o no visible responde `NOT_VISIBLE` sin distinguir ambos casos.
   */
  private async subscribeResource(
    client: Socket,
    resource: Extract<ProjectResourceKind, 'projectVersion' | 'analysisRun' | 'experiment'>,
    resourceId: string,
    subscription: RoomSubscription,
  ): Promise<SubscribeAck> {
    const userId = client.data.userId as string;

    try {
      const { project } = await this.projectAccess.requireForResource(userId, resource, resourceId, 'READER');
      subscription.track(project.id);

      try {
        await client.join(subscription.room);
      } catch (error) {
        subscription.untrack();
        throw error;
      }

      if (!(await this.subscriptions.revalidateSocket(client.id, project.id))) {
        await client.leave(subscription.room);
        return NOT_VISIBLE;
      }

      return SUBSCRIBED;
    } catch (error) {
      if (error instanceof AppException) {
        if (error.code === ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE) {
          return VERIFICATION_UNAVAILABLE;
        }
        // 404 (recurso inexistente o Project no visible): indistinguibles. Un Reader nunca da 403.
        if (error.getStatus() === HttpStatus.NOT_FOUND) {
          return NOT_VISIBLE;
        }
      }
      throw error;
    }
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
