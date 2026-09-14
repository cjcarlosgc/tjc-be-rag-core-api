import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
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
export class RealtimeGateway {
  @WebSocketServer()
  private server?: Server;

  constructor(private readonly projectVersionsRepository: ProjectVersionsRepository) {}

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
