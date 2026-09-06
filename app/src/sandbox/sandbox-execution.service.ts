import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFailureFact,
} from './sandbox.types.js';

const DEFAULT_DOWNLOAD_TTL_SECONDS = 300;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;

interface EphemeralDownloadRef {
  role: 'PROJECT_SNAPSHOT' | 'GENERATED_ARTIFACT';
  url: string;
  expiresAt: string;
  sha256: string;
  sizeBytes: number;
}

export class SandboxUnavailableError extends Error {}

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

    const requestId = randomUUID();
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

    const body = {
      requestId,
      testRunId: request.testRunId,
      projectVersionId: request.projectVersionId,
      snapshot,
      artifacts,
      scope: request.scope,
      targetIds: request.targetIds,
      runnerHint: request.runnerHint,
    };

    const accepted = await this.postJson<{ executionId: string; pollAfterMs: number }>(
      `${baseUrl}/executions`,
      body,
      requestId,
      correlationId,
    );

    await this.pollUntilTerminal(baseUrl, accepted.executionId, accepted.pollAfterMs, correlationId);

    return this.fetchResult(baseUrl, accepted.executionId, correlationId);
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
  ): Promise<SandboxExecutionResult> {
    const result = await this.getJson<{
      status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
      facts: SandboxExecutionResult['facts'];
      failure: SandboxFailureFact | null;
    }>(`${baseUrl}/executions/${executionId}/result`, correlationId);

    return { status: result.status, facts: result.facts, failure: result.failure };
  }

  private async postJson<T>(
    url: string,
    body: unknown,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify(body),
    });
  }

  private async getJson<T>(url: string, correlationId: string): Promise<T> {
    return this.request<T>(url, { method: 'GET', headers: { 'x-correlation-id': correlationId } });
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
