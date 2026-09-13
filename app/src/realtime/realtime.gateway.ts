import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { ProjectVersionResponse } from '../project-versions/dto/project-version.response.js';
import type { TestRunStatusResponse } from '../generation/dto/test-run.response.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { TestGenerationRunsRepository } from '../generation/persistence/test-generation-runs.repository.js';

function projectVersionRoom(projectVersionId: string): string {
  return `project-version:${projectVersionId}`;
}

function testRunRoom(testRunId: string): string {
  return `test-run:${testRunId}`;
}

/**
 * HU21/HU22: complemento de los endpoints de estado por polling, nunca un
 * reemplazo. Un cliente se suscribe a un id específico (sala por id); el
 * servidor nunca hace broadcast global. Contrato en
 * `spec/contracts/interoperability-contract.md` sección 6.6.
 */
@WebSocketGateway({ cors: true })
export class RealtimeGateway {
  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testGenerationRunsRepository: TestGenerationRunsRepository,
  ) {}

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

  @SubscribeMessage('subscribe:test-run')
  async subscribeTestRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { testRunId: string },
  ): Promise<void> {
    const owned = await this.testGenerationRunsRepository.findByIdForOwner(
      body.testRunId,
      client.data.userId as string,
    );

    if (owned) {
      void client.join(testRunRoom(body.testRunId));
    }
  }

  @SubscribeMessage('unsubscribe:test-run')
  unsubscribeTestRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { testRunId: string },
  ): void {
    void client.leave(testRunRoom(body.testRunId));
  }

  emitProjectVersionUpdate(projectVersionId: string, payload: ProjectVersionResponse): void {
    this.server?.to(projectVersionRoom(projectVersionId)).emit('project-version:update', payload);
  }

  emitTestRunUpdate(testRunId: string, payload: TestRunStatusResponse): void {
    this.server?.to(testRunRoom(testRunId)).emit('test-run:update', payload);
  }
}
