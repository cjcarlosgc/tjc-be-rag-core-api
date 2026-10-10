import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import type {
  ExecutionProfile,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFailureFact,
} from './sandbox.types.js';

const DEFAULT_DOWNLOAD_TTL_SECONDS = 300;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_POLL_ATTEMPTS = 120;

// Keep the mapping exhaustive: adding a runner requires selecting its profile.
export const EXECUTION_PROFILE_BY_RUNNER: Record<SandboxExecutionRequest['runnerHint'], ExecutionProfile> = {
  JEST: 'NODE_TYPESCRIPT',
  VITEST: 'NODE_TYPESCRIPT',
};

interface EphemeralDownloadRef {
  role: 'PROJECT_SNAPSHOT' | 'GENERATED_ARTIFACT';
  url: string;
  expiresAt: string;
  sha256: string;
  sizeBytes: number;
}

export class SandboxUnavailableError extends Error {}

/**
 * Fallo posterior a la aceptación del Sandbox (`POST /executions` ya respondió): conserva el
 * `executionId` para que Core lo persista aunque la ejecución no llegue a un resultado (WI-CORE-026).
 * Es un `SandboxUnavailableError`, así que los llamadores existentes no cambian de comportamiento.
 */
export class SandboxAcceptedExecutionError extends SandboxUnavailableError {
  constructor(
    message: string,
    readonly executionId: string,
    readonly executionProfile: ExecutionProfile,
  ) {
    super(message);
  }
}

type SandboxExecutionOutcome = Omit<SandboxExecutionResult, 'executionId' | 'executionProfile'>;

@Injectable()
export class SandboxExecutionService {
  private readonly logger = new Logger(SandboxExecutionService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    const baseUrl = this.configService.get<string>('SANDBOX_URL');

    if (!baseUrl) {
      throw new SandboxUnavailableError('SANDBOX_URL no está configurado.');
    }

    const serviceToken = this.configService.get<string>('SANDBOX_SERVICE_TOKEN');

    if (!serviceToken) {
      throw new SandboxUnavailableError('SANDBOX_SERVICE_TOKEN no está configurado (DEC-AUTH-001).');
    }

    const { requestId } = request;
    const correlationId = randomUUID();
    const ttl = this.configService.get<number>(
      'SANDBOX_DOWNLOAD_TTL_SECONDS',
      DEFAULT_DOWNLOAD_TTL_SECONDS,
    );

    const snapshot = await this.buildSnapshotRef(request.snapshotKey, request.snapshotBuffer, ttl);
    const artifacts = await Promise.all(
      request.artifacts.map(async (artifact) => ({
        artifactId: artifact.artifactId,
        relativePath: artifact.relativePath,
        artifactType: artifact.artifactType,
        download: await this.buildArtifactRef(request.testRunId, artifact.content, ttl),
      })),
    );

    const executionProfile = request.executionProfile ?? EXECUTION_PROFILE_BY_RUNNER[request.runnerHint];
    const body = {
      requestId,
      testRunId: request.testRunId,
      projectVersionId: request.projectVersionId,
      snapshot,
      artifacts,
      scope: request.scope,
      targetIds: request.targetIds,
      executionProfile,
      runnerHint: request.runnerHint,
    };

    const accepted = await this.postJson<{ executionId: string; pollAfterMs: number }>(
      `${baseUrl}/executions`,
      body,
      requestId,
      correlationId,
      serviceToken,
    );

    try {
      await this.pollUntilTerminal(
        baseUrl,
        accepted.executionId,
        accepted.pollAfterMs,
        correlationId,
        serviceToken,
      );

      const outcome = await this.fetchResult(baseUrl, accepted.executionId, correlationId, serviceToken);
      return { ...outcome, executionId: accepted.executionId, executionProfile };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fallo desconocido tras aceptar la ejecución.';
      throw new SandboxAcceptedExecutionError(message, accepted.executionId, executionProfile);
    }
  }

  private async buildSnapshotRef(
    snapshotKey: string,
    snapshotBuffer: Buffer,
    ttlSeconds: number,
  ): Promise<EphemeralDownloadRef> {
    const url = await this.objectStorageService.presignGet(snapshotKey, ttlSeconds);
    return this.toDownloadRef('PROJECT_SNAPSHOT', url, snapshotBuffer, ttlSeconds);
  }

  private async buildArtifactRef(
    testRunId: string,
    content: Buffer,
    ttlSeconds: number,
  ): Promise<EphemeralDownloadRef> {
    const key = `test-runs/${testRunId}/validation/${randomUUID()}`;
    await this.objectStorageService.put(key, content, 'text/plain');
    const url = await this.objectStorageService.presignGet(key, ttlSeconds);
    return this.toDownloadRef('GENERATED_ARTIFACT', url, content, ttlSeconds);
  }

  private toDownloadRef(
    role: EphemeralDownloadRef['role'],
    url: string,
    content: Buffer,
    ttlSeconds: number,
  ): EphemeralDownloadRef {
    return {
      role,
      url,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.length,
    };
  }

  private async pollUntilTerminal(
    baseUrl: string,
    executionId: string,
    firstPollAfterMs: number,
    correlationId: string,
    serviceToken: string,
  ): Promise<void> {
    const maxAttempts = this.configService.get<number>(
      'SANDBOX_MAX_POLL_ATTEMPTS',
      DEFAULT_MAX_POLL_ATTEMPTS,
    );
    let pollAfterMs = firstPollAfterMs;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, pollAfterMs));

      const status = await this.getJson<{ status: string; pollAfterMs?: number }>(
        `${baseUrl}/executions/${executionId}`,
        correlationId,
        serviceToken,
      );

      if (['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(status.status)) {
        return;
      }

      pollAfterMs = status.pollAfterMs ?? firstPollAfterMs;
    }

    throw new SandboxUnavailableError(
      `La ejecución ${executionId} no terminó tras ${maxAttempts} consultas de estado.`,
    );
  }

  private async fetchResult(
    baseUrl: string,
    executionId: string,
    correlationId: string,
    serviceToken: string,
  ): Promise<SandboxExecutionOutcome> {
    const result = await this.getJson<{
      status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
      facts: SandboxExecutionResult['facts'];
      failure: SandboxFailureFact | null;
      stageDurations?: SandboxExecutionResult['stageDurations'];
    }>(`${baseUrl}/executions/${executionId}/result`, correlationId, serviceToken);

    const stageDurations = result.stageDurations ?? [];

    if (stageDurations.length > 0) {
      this.logger.debug(
        `Ejecución ${executionId} stage timings: ${stageDurations
          .map((stage) => `${stage.stage}=${stage.durationMs}ms`)
          .join(', ')}`,
      );
    }

    if (result.failure) {
      // `mapSandboxResult` solo persiste la categoría (`failureType`) en
      // `ExperimentRepetition` (ese modelo no tiene columna de mensaje); sin
      // este log, el detalle real del Sandbox (p. ej. qué dependencia falta)
      // se pierde para siempre en los experimentos.
      // WI-CORE-027 (IDEA-016): el mensaje se registra saneado; el canal de logs no debe recibir secretos.
      this.logger.warn(
        `Ejecución ${executionId} falló en ${result.failure.stage} (${result.failure.category}/${result.failure.code}): ${sanitizeFailureMessage(String(result.failure.message))}`,
      );
    }

    return { status: result.status, facts: result.facts, failure: result.failure, stageDurations };
  }

  private async postJson<T>(
    url: string,
    body: unknown,
    idempotencyKey: string,
    correlationId: string,
    serviceToken: string,
  ): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'x-correlation-id': correlationId,
        authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  private async getJson<T>(url: string, correlationId: string, serviceToken: string): Promise<T> {
    return this.request<T>(url, {
      method: 'GET',
      headers: { 'x-correlation-id': correlationId, authorization: `Bearer ${serviceToken}` },
    });
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const timeoutMs = this.configService.get<number>(
      'SANDBOX_REQUEST_TIMEOUT_MS',
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (!response.ok) {
        throw new SandboxUnavailableError(`Sandbox respondió ${response.status} para ${url}.`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SandboxUnavailableError) {
        throw error;
      }

      this.logger.warn(`Fallo al comunicarse con el Sandbox (${url}): ${(error as Error).message}`);
      throw new SandboxUnavailableError((error as Error).message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
