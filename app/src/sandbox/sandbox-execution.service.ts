import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';
import { validateContract } from '../contracts/contract-validator.js';
import { DEFAULT_POLL_RETRIES, DEFAULT_POLL_RETRY_DELAY_MS, MAX_POLL_AFTER_MS } from '../config/sandbox-poll.defaults.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import type {
  ExecutionProfile,
  SandboxExecutionEvidenceFact,
  SandboxExecutionEvidenceKind,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFailureFact,
} from './sandbox.types.js';

const EVIDENCE_KINDS: ReadonlySet<string> = new Set<SandboxExecutionEvidenceKind>([
  'COMPILER_STDOUT',
  'COMPILER_STDERR',
  'TEST_STDOUT',
  'TEST_STDERR',
  'RUNNER_REPORT',
]);

/**
 * WI-CORE-060: lee la evidencia acotada del Sandbox sin confiar en su forma. Un campo ausente o que no es
 * arreglo da []; una entrada sin un `kind` conocido, con `content` no string o con `truncated` no booleano
 * se descarta. Nunca lanza.
 */
export function parseSandboxEvidence(raw: unknown): SandboxExecutionEvidenceFact[] {
  if (!Array.isArray(raw)) return [];
  const facts: SandboxExecutionEvidenceFact[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.kind !== 'string' || !EVIDENCE_KINDS.has(candidate.kind)) continue;
    if (typeof candidate.content !== 'string') continue;
    if (typeof candidate.truncated !== 'boolean') continue;
    facts.push({
      kind: candidate.kind as SandboxExecutionEvidenceKind,
      stage: typeof candidate.stage === 'string' ? candidate.stage : null,
      content: candidate.content,
      truncated: candidate.truncated,
      originalBytes: typeof candidate.originalBytes === 'number' ? candidate.originalBytes : null,
    });
  }
  return facts;
}

/**
 * WI-CORE-061: acepta solo una cadena ISO-8601 en UTC (termina en `Z`) que Date pueda parsear.
 * Cualquier otro valor se trata como ausente.
 */
function isUtcIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('Z') && !Number.isNaN(Date.parse(value));
}

/**
 * WI-CORE-061: conserva `stage` y `durationMs` tal como los devuelve el Sandbox y añade `startedAt`/`completedAt`
 * solo cuando son ISO-8601 UTC válidos. Una entrada que no es objeto se pasa sin cambios.
 */
function normalizeStageDurations(raw: unknown): SandboxExecutionResult['stageDurations'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: unknown) => {
    if (entry === null || typeof entry !== 'object') return entry as SandboxExecutionResult['stageDurations'][number];
    const candidate = entry as Record<string, unknown>;
    const stage: SandboxExecutionResult['stageDurations'][number] = {
      stage: candidate.stage as SandboxExecutionResult['stageDurations'][number]['stage'],
      durationMs: candidate.durationMs as number,
    };
    if (isUtcIsoTimestamp(candidate.startedAt)) stage.startedAt = candidate.startedAt;
    if (isUtcIsoTimestamp(candidate.completedAt)) stage.completedAt = candidate.completedAt;
    return stage;
  });
}

const DEFAULT_DOWNLOAD_TTL_SECONDS = 300;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_POLL_ATTEMPTS = 120;

// Keep the mapping exhaustive: adding a runner requires selecting its profile.
export const EXECUTION_PROFILE_BY_RUNNER: Record<
  SandboxExecutionRequest['runnerHint'],
  ExecutionProfile
> = {
  JEST: 'NODE_TYPESCRIPT',
  VITEST: 'NODE_TYPESCRIPT',
  PHPUNIT: 'PHP_LARAVEL_PHPUNIT',
};

interface EphemeralDownloadRef {
  role: 'PROJECT_SNAPSHOT' | 'GENERATED_ARTIFACT';
  url: string;
  expiresAt: string;
  sha256: string;
  sizeBytes: number;
}

export class SandboxUnavailableError extends Error {
  /**
   * `transient` = el fallo es de red/tiempo de espera o una respuesta 408/425/429/5xx del Sandbox: repetir una
   * consulta idempotente (GET) puede tener éxito. Un 4xx de contrato no es transitorio.
   */
  constructor(
    message: string,
    readonly transient: boolean = false,
  ) {
    super(message);
  }
}

// Re-exportados para los consumidores existentes; la fuente única es config/sandbox-poll.defaults.ts.
export { DEFAULT_POLL_RETRIES, DEFAULT_POLL_RETRY_DELAY_MS, MAX_POLL_AFTER_MS };
const FALLBACK_POLL_AFTER_MS = 1_000;

/** Acota el `pollAfterMs` que informa el Sandbox: un valor ausente, no numérico o negativo usa el de respaldo. */
export function clampPollAfterMs(value: unknown, fallback = FALLBACK_POLL_AFTER_MS): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  return Math.min(candidate, MAX_POLL_AFTER_MS);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Fallo posterior a la aceptación del Sandbox (`POST /executions` ya respondió): conserva el
 * `executionId` para que Core lo persista aunque la ejecución no llegue a un resultado (WI-CORE-026).
 * Es un `SandboxUnavailableError`, así que los llamadores existentes no cambian de comportamiento.
 */
export class SandboxAcceptedExecutionError extends SandboxUnavailableError {
  /**
   * WI-CORE-027: `requestId`, `correlationId` y `durationMs` solo existen tras la aceptación; por defecto son
   * `null` (no observados). Un fallo previo a `POST /executions` no los informa, nunca con valores inventados.
   */
  constructor(
    message: string,
    readonly executionId: string,
    readonly executionProfile: ExecutionProfile,
    readonly requestId: string | null = null,
    readonly correlationId: string | null = null,
    readonly durationMs: number | null = null,
  ) {
    super(message);
  }
}

type SandboxExecutionOutcome = Omit<
  SandboxExecutionResult,
  | 'executionId'
  | 'executionProfile'
  | 'requestId'
  | 'correlationId'
  | 'durationMs'
>;

/** Consultas idempotentes que se reintentan ante un fallo transitorio (WI-CORE-070 corte C). */
export type SandboxPollOperation = 'status' | 'result';

@Injectable()
export class SandboxExecutionService {
  private readonly logger = new Logger(SandboxExecutionService.name);
  /** WI-CORE-070 corte C: reintentos transitorios realizados por esta instancia (solo los que se repiten). */
  private transientRetriesTotal = 0;
  private readonly transientRetryCountByOperation: Record<SandboxPollOperation, number> = {
    status: 0,
    result: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  /** Número de reintentos transitorios realizados por esta instancia (no cuenta el intento inicial). */
  get transientRetryCount(): number {
    return this.transientRetriesTotal;
  }

  /** Reintentos transitorios realizados, desglosados por operación de consulta. Copia de solo lectura. */
  get transientRetriesByOperation(): Readonly<Record<SandboxPollOperation, number>> {
    return { ...this.transientRetryCountByOperation };
  }

  async execute(
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const baseUrl = this.configService.get<string>('SANDBOX_URL');

    if (!baseUrl) {
      throw new SandboxUnavailableError('SANDBOX_URL no está configurado.');
    }

    const serviceToken = this.configService.get<string>(
      'SANDBOX_SERVICE_TOKEN',
    );

    if (!serviceToken) {
      throw new SandboxUnavailableError(
        'SANDBOX_SERVICE_TOKEN no está configurado (DEC-AUTH-001).',
      );
    }

    const { requestId } = request;
    const correlationId = randomUUID();
    const ttl = this.configService.get<number>(
      'SANDBOX_DOWNLOAD_TTL_SECONDS',
      DEFAULT_DOWNLOAD_TTL_SECONDS,
    );

    const snapshot = await this.buildSnapshotRef(
      request.snapshotKey,
      request.snapshotBuffer,
      ttl,
    );
    const artifacts = await Promise.all(
      request.artifacts.map(async (artifact) => ({
        artifactId: artifact.artifactId,
        relativePath: artifact.relativePath,
        artifactType: artifact.artifactType,
        download: await this.buildArtifactRef(
          request.testRunId,
          artifact.content,
          ttl,
        ),
      })),
    );

    const executionProfile =
      request.executionProfile ??
      EXECUTION_PROFILE_BY_RUNNER[request.runnerHint];
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
      ...(request.projectRoot === undefined
        ? {}
        : { projectRoot: request.projectRoot }),
    };

    // WI-CORE-027: el cronómetro cubre la llamada real, desde el envío de `POST /executions`.
    const startedAt = Date.now();
    const accepted = await this.postJson<{
      executionId: string;
      pollAfterMs: number;
    }>(`${baseUrl}/executions`, body, requestId, correlationId, serviceToken);
    this.warnOnContractDrift('SandboxExecutionAcceptedResponse', accepted.executionId, accepted);

    try {
      await this.pollUntilTerminal(
        baseUrl,
        accepted.executionId,
        accepted.pollAfterMs,
        correlationId,
        serviceToken,
      );

      const outcome = await this.fetchResult(
        baseUrl,
        accepted.executionId,
        correlationId,
        serviceToken,
      );
      return {
        ...outcome,
        executionId: accepted.executionId,
        executionProfile,
        requestId,
        correlationId,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Fallo desconocido tras aceptar la ejecución.';
      throw new SandboxAcceptedExecutionError(
        message,
        accepted.executionId,
        executionProfile,
        requestId,
        correlationId,
        Date.now() - startedAt,
      );
    }
  }

  private async buildSnapshotRef(
    snapshotKey: string,
    snapshotBuffer: Buffer,
    ttlSeconds: number,
  ): Promise<EphemeralDownloadRef> {
    const url = await this.objectStorageService.presignGet(
      snapshotKey,
      ttlSeconds,
    );
    return this.toDownloadRef(
      'PROJECT_SNAPSHOT',
      url,
      snapshotBuffer,
      ttlSeconds,
    );
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
    let pollAfterMs = clampPollAfterMs(firstPollAfterMs);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, pollAfterMs));

      const status = await this.withTransientRetries('status', executionId, () =>
        this.getJson<{
          status: string;
          pollAfterMs?: number;
        }>(`${baseUrl}/executions/${executionId}`, correlationId, serviceToken),
      );

      if (['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(status.status)) {
        return;
      }

      pollAfterMs = clampPollAfterMs(status.pollAfterMs, clampPollAfterMs(firstPollAfterMs));
    }

    throw new SandboxUnavailableError(
      `La ejecución ${executionId} no terminó tras ${maxAttempts} consultas de estado.`,
    );
  }

  /**
   * Repite una consulta idempotente ante fallos transitorios del Sandbox (red, tiempo de espera, 408/425/429/5xx) con
   * espera creciente. Un fallo no transitorio, o agotar los reintentos, relanza el último error.
   * WI-CORE-070 corte C: cada reintento que se realiza queda registrado (operación, executionId, número y total,
   * clase del error, espera; el mensaje va saneado) y cuenta en los contadores de la instancia. No cambia
   * cuántos reintentos hay ni las esperas.
   */
  private async withTransientRetries<T>(
    operation: SandboxPollOperation,
    executionId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const retries = this.configService.get<number>('SANDBOX_POLL_RETRIES', DEFAULT_POLL_RETRIES);
    const baseDelayMs = this.configService.get<number>('SANDBOX_POLL_RETRY_DELAY_MS', DEFAULT_POLL_RETRY_DELAY_MS);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const retryable = error instanceof SandboxUnavailableError && error.transient;
        if (!retryable || attempt >= retries) throw error;
        const delayMs = Math.min(baseDelayMs * 2 ** attempt, MAX_POLL_AFTER_MS);
        this.transientRetriesTotal += 1;
        this.transientRetryCountByOperation[operation] += 1;
        this.logger.warn(
          `Reintento transitorio (${operation}) de la ejecución ${executionId}: reintento ${attempt + 1} de ${retries}, ` +
            `error ${error.constructor.name}, espera ${delayMs}ms: ${sanitizeFailureMessage(String(error.message))}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async fetchResult(
    baseUrl: string,
    executionId: string,
    correlationId: string,
    serviceToken: string,
  ): Promise<SandboxExecutionOutcome> {
    const result = await this.withTransientRetries('result', executionId, () =>
      this.getJson<{
        status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
        facts: SandboxExecutionResult['facts'];
        failure: SandboxFailureFact | null;
        stageDurations?: unknown;
        evidence?: unknown;
        startedAt?: unknown;
        completedAt?: unknown;
      }>(`${baseUrl}/executions/${executionId}/result`, correlationId, serviceToken),
    );

    this.warnOnContractDrift('SandboxExecutionResultResponse', executionId, result);

    const stageDurations = normalizeStageDurations(result.stageDurations);

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

    return {
      status: result.status,
      facts: result.facts,
      failure: result.failure,
      stageDurations,
      evidence: parseSandboxEvidence(result.evidence),
      startedAt: typeof result.startedAt === 'string' ? result.startedAt : null,
      completedAt: typeof result.completedAt === 'string' ? result.completedAt : null,
    };
  }

  /**
   * INTEROP-2.17 §10: compara la respuesta del Sandbox con el esquema canónico y avisa de cualquier desvío. No lanza
   * ni altera el flujo (Core tolera Sandboxes anteriores); el aviso solo lista rutas y motivos, nunca valores.
   */
  private warnOnContractDrift(
    definition: 'SandboxExecutionAcceptedResponse' | 'SandboxExecutionResultResponse',
    executionId: string,
    payload: unknown,
  ): void {
    const check = validateContract('sandbox-execution.schema.json', definition, payload);
    if (check.valid) return;
    this.logger.warn(
      `Contrato Core↔Sandbox (INTEROP §7): la respuesta ${definition} de la ejecución ${executionId} no cumple el esquema canónico: ${check.errors.slice(0, 5).join('; ')}`,
    );
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

  private async getJson<T>(
    url: string,
    correlationId: string,
    serviceToken: string,
  ): Promise<T> {
    return this.request<T>(url, {
      method: 'GET',
      headers: {
        'x-correlation-id': correlationId,
        authorization: `Bearer ${serviceToken}`,
      },
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
        throw new SandboxUnavailableError(
          `Sandbox respondió ${response.status} para ${url}.`,
          isTransientStatus(response.status),
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SandboxUnavailableError) {
        throw error;
      }

      this.logger.warn(
        `Fallo al comunicarse con el Sandbox (${url}): ${(error as Error).message}`,
      );
      throw new SandboxUnavailableError((error as Error).message, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
