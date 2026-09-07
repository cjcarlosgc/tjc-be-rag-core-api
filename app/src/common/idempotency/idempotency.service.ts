import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { canonicalJsonStringify } from '../canonical-json.util.js';

/** DEC-IDEMP-001 / spec/transversal/persistence/spec.md */
export type IdempotencyScope = 'TEST_RUN_CREATE' | 'EXPERIMENT_CREATE' | 'TARGET_RETRY';

export interface IdempotencyRunParams<T> {
  scope: IdempotencyScope;
  /** Header `Idempotency-Key` tal como llegó del cliente (sin validar). */
  key: string | undefined;
  /** Huella canónica del request: scope + este valor, serializado con keys ordenadas. */
  fingerprintInput: unknown;
  /**
   * Crea el recurso + encola el job dentro de la transacción `tx`. Devuelve
   * `operationId` (el runId/experimentId/retryJobId original, referenciado
   * por el registro de idempotencia) y la respuesta 202 a devolver.
   */
  create: (tx: Prisma.TransactionClient) => Promise<{ operationId: string; response: T }>;
  /**
   * Reconstruye la respuesta 202 en un replay, a partir del `operationId`
   * guardado. No se persiste el cuerpo de la respuesta original.
   */
  rebuildResponse: (operationId: string) => Promise<T>;
}

interface StoredIdempotencyRecord {
  requestFingerprint: string;
  operationId: string;
}

/**
 * DEC-IDEMP-001: persiste `(scope, idempotencyKey)` + huella canónica bajo
 * una restricción única compuesta. Mismo par (scope, key) con la misma
 * huella reconstruye la respuesta 202 original a partir de `operationId`,
 * sin repetir la creación del recurso ni encolar un job adicional; misma key
 * con huella distinta responde `409 IDEMPOTENCY_CONFLICT`. La creación del
 * recurso, el job y la reserva de idempotencia se hacen en una única
 * transacción, para que sean atómicos (o, si falla, completamente
 * recuperables sin haber duplicado trabajo).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(params: IdempotencyRunParams<T>): Promise<T> {
    const key = this.validateKey(params.key);
    const fingerprint = this.computeFingerprint(params.scope, params.fingerprintInput);
    const where = { scope_idempotencyKey: { scope: params.scope, idempotencyKey: key } };

    const existing = await this.prisma.idempotencyRecord.findUnique({ where });

    if (existing) {
      return this.resolveExisting(existing, fingerprint, params.rebuildResponse);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const recheck = await tx.idempotencyRecord.findUnique({ where });

        if (recheck) {
          return this.resolveExisting(recheck, fingerprint, params.rebuildResponse);
        }

        const { operationId, response } = await params.create(tx);

        await tx.idempotencyRecord.create({
          data: {
            scope: params.scope,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            operationId,
          },
        });

        return response;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.idempotencyRecord.findUnique({ where });

        if (winner) {
          return this.resolveExisting(winner, fingerprint, params.rebuildResponse);
        }
      }

      throw error;
    }
  }

  private resolveExisting<T>(
    existing: StoredIdempotencyRecord,
    fingerprint: string,
    rebuildResponse: (operationId: string) => Promise<T>,
  ): Promise<T> {
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        'La misma Idempotency-Key se usó con un request distinto.',
        HttpStatus.CONFLICT,
      );
    }

    return rebuildResponse(existing.operationId);
  }

  private validateKey(key: string | undefined): string {
    if (!key) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Falta el header Idempotency-Key.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!isUUID(key)) {
      throw new AppException(
        ErrorCode.INVALID_IDEMPOTENCY_KEY,
        'Idempotency-Key debe ser un UUID válido.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return key;
  }

  private computeFingerprint(scope: IdempotencyScope, input: unknown): string {
    return createHash('sha256').update(canonicalJsonStringify({ scope, input })).digest('hex');
  }
}
