import { describe, expect, it, vi } from 'vitest';
import { IdempotencyService } from './idempotency.service.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { Prisma } from '../../generated/prisma/client.js';

function makeFakePrisma() {
  const idempotencyRecord = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    idempotencyRecord,
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback({ idempotencyRecord })),
  };
  return { prisma, idempotencyRecord };
}

const VALID_KEY = '11111111-1111-4111-8111-111111111111';

describe('IdempotencyService', () => {
  it('throws IDEMPOTENCY_KEY_REQUIRED when the key is missing', async () => {
    const { prisma } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);

    await expect(
      service.run({
        scope: 'TEST_RUN_CREATE',
        key: undefined,
        fingerprintInput: {},
        create: vi.fn(),
        rebuildResponse: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED });
  });

  it('throws INVALID_IDEMPOTENCY_KEY when the key is not a UUID', async () => {
    const { prisma } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);

    await expect(
      service.run({
        scope: 'TEST_RUN_CREATE',
        key: 'not-a-uuid',
        fingerprintInput: {},
        create: vi.fn(),
        rebuildResponse: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_IDEMPOTENCY_KEY });
  });

  it('runs create(), persists (scope, key, fingerprint, operationId) and returns the response when no record exists yet', async () => {
    const { prisma, idempotencyRecord } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);
    const create = vi.fn().mockResolvedValue({
      operationId: 'run-1',
      response: { runId: 'run-1', status: 'PENDING' },
    });

    const result = await service.run({
      scope: 'TEST_RUN_CREATE',
      key: VALID_KEY,
      fingerprintInput: { projectId: 'p1' },
      create,
      rebuildResponse: vi.fn(),
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ runId: 'run-1', status: 'PENDING' });
    expect(idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'TEST_RUN_CREATE',
        idempotencyKey: VALID_KEY,
        operationId: 'run-1',
      }),
    });
  });

  it('replays via rebuildResponse(operationId) without re-running create() when the fingerprint matches', async () => {
    const { prisma, idempotencyRecord } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);
    const create = vi.fn().mockResolvedValue({
      operationId: 'run-1',
      response: { runId: 'run-1', status: 'PENDING' },
    });
    const rebuildResponse = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'PENDING' });

    await service.run({
      scope: 'TEST_RUN_CREATE',
      key: VALID_KEY,
      fingerprintInput: { projectId: 'p1' },
      create,
      rebuildResponse,
    });

    const storedFingerprint = idempotencyRecord.create.mock.calls[0][0].data.requestFingerprint;
    idempotencyRecord.findUnique.mockResolvedValue({
      requestFingerprint: storedFingerprint,
      operationId: 'run-1',
    });

    const second = await service.run({
      scope: 'TEST_RUN_CREATE',
      key: VALID_KEY,
      fingerprintInput: { projectId: 'p1' },
      create,
      rebuildResponse,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(rebuildResponse).toHaveBeenCalledWith('run-1');
    expect(second).toEqual({ runId: 'run-1', status: 'PENDING' });
  });

  it('scopes the fingerprint: the same fingerprintInput under a different scope does not collide', async () => {
    const { prisma } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);
    const create1 = vi.fn().mockResolvedValue({ operationId: 'run-1', response: { a: 1 } });
    const create2 = vi.fn().mockResolvedValue({ operationId: 'retry-job-1', response: { b: 2 } });

    await service.run({
      scope: 'TEST_RUN_CREATE',
      key: VALID_KEY,
      fingerprintInput: { testRunId: 'run-1', targetId: 'target-1' },
      create: create1,
      rebuildResponse: vi.fn(),
    });

    // Distinto scope, mismo `fingerprintInput`: no debería reusar el registro
    // del primer scope (la huella incluye el scope).
    await service.run({
      scope: 'TARGET_RETRY',
      key: VALID_KEY,
      fingerprintInput: { testRunId: 'run-1', targetId: 'target-1' },
      create: create2,
      rebuildResponse: vi.fn(),
    });

    expect(create1).toHaveBeenCalledTimes(1);
    expect(create2).toHaveBeenCalledTimes(1);
  });

  it('throws IDEMPOTENCY_CONFLICT when the same (scope, key) is reused with a different fingerprint', async () => {
    const { prisma, idempotencyRecord } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);

    idempotencyRecord.findUnique.mockResolvedValue({
      requestFingerprint: 'some-other-hash',
      operationId: 'run-1',
    });
    const create = vi.fn();

    await expect(
      service.run({
        scope: 'TEST_RUN_CREATE',
        key: VALID_KEY,
        fingerprintInput: { projectId: 'p2' },
        create,
        rebuildResponse: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_CONFLICT });
    expect(create).not.toHaveBeenCalled();
  });

  it('resolves via rebuildResponse when a concurrent request wins the unique-constraint race', async () => {
    const { prisma, idempotencyRecord } = makeFakePrisma();
    const service = new IdempotencyService(prisma as never);
    const create = vi.fn().mockResolvedValue({
      operationId: 'run-1',
      response: { runId: 'run-1', status: 'PENDING' },
    });
    const rebuildResponse = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'PENDING' });

    let fingerprint = '';
    idempotencyRecord.create.mockImplementationOnce(
      async (args: { data: { requestFingerprint: string } }) => {
        fingerprint = args.data.requestFingerprint;
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });
      },
    );
    idempotencyRecord.findUnique.mockImplementation(async () =>
      fingerprint ? { requestFingerprint: fingerprint, operationId: 'run-1' } : null,
    );

    const result = await service.run({
      scope: 'TEST_RUN_CREATE',
      key: VALID_KEY,
      fingerprintInput: { projectId: 'p1' },
      create,
      rebuildResponse,
    });

    expect(rebuildResponse).toHaveBeenCalledWith('run-1');
    expect(result).toEqual({ runId: 'run-1', status: 'PENDING' });
  });
});
