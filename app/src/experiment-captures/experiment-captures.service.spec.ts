import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { ExperimentCapture } from '../generated/prisma/client.js';
import { ExperimentCapturesService } from './experiment-captures.service.js';
import {
  ExperimentCaptureAlreadyArmedError,
  type ExperimentCapturesRepository,
} from './persistence/experiment-captures.repository.js';
import {
  toExperimentCaptureReservationResponse,
  toExperimentCaptureResponse,
} from './dto/experiment-capture.response.js';

/** WI-CORE-109 (HU18): servicio de capturas armadas, sobre un repositorio simulado. */
describe('ExperimentCapturesService (WI-CORE-109)', () => {
  const PROJECT_ID = 'project-1';
  const USER_ID = 'user-maintainer';
  const ARMED_AT = new Date('2026-10-30T10:00:00.000Z');

  function capture(overrides: Partial<ExperimentCapture> = {}): ExperimentCapture {
    return {
      id: 'capture-1',
      projectId: PROJECT_ID,
      status: 'ARMED',
      armedByUserId: USER_ID,
      armedAt: ARMED_AT,
      reservedAnalysisRunId: null,
      reservedAt: null,
      disarmedByUserId: null,
      disarmedAt: null,
      createdAt: ARMED_AT,
      updatedAt: ARMED_AT,
      ...overrides,
    };
  }

  function build() {
    const repository = {
      arm: vi.fn(),
      list: vi.fn(),
      disarmArmed: vi.fn(),
    };
    const service = new ExperimentCapturesService(repository as unknown as ExperimentCapturesRepository);
    return { repository, service };
  }

  describe('arm', () => {
    it('crea una captura ARMED con el usuario que la arma y la devuelve con fechas ISO-8601 UTC', async () => {
      const { repository, service } = build();
      repository.arm.mockResolvedValue(capture());

      const response = await service.arm(PROJECT_ID, USER_ID);

      expect(repository.arm).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
      expect(response).toEqual({
        captureId: 'capture-1',
        projectId: PROJECT_ID,
        status: 'ARMED',
        armedBy: USER_ID,
        armedAt: '2026-10-30T10:00:00.000Z',
        reservedAnalysisRunId: null,
        reservedAt: null,
        disarmedBy: null,
        disarmedAt: null,
      });
    });

    it('una segunda captura armada responde 409 EXPERIMENT_CAPTURE_ALREADY_ARMED (retryable false por contrato)', async () => {
      const { repository, service } = build();
      repository.arm.mockRejectedValue(new ExperimentCaptureAlreadyArmedError(PROJECT_ID));

      const error = await service.arm(PROJECT_ID, USER_ID).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({ code: ErrorCode.EXPERIMENT_CAPTURE_ALREADY_ARMED, status: 409 });
    });

    it('propaga los errores que no son de unicidad sin traducirlos', async () => {
      const { repository, service } = build();
      repository.arm.mockRejectedValue(new Error('db down'));

      await expect(service.arm(PROJECT_ID, USER_ID)).rejects.toThrow('db down');
    });
  });

  describe('disarmCurrent', () => {
    it('desarma la captura ARMED: estado DISARMED con quién y cuándo', async () => {
      const { repository, service } = build();
      const disarmedAt = new Date('2026-10-30T11:00:00.000Z');
      repository.disarmArmed.mockResolvedValue(
        capture({ status: 'DISARMED', disarmedByUserId: USER_ID, disarmedAt }),
      );

      const response = await service.disarmCurrent(PROJECT_ID, USER_ID);

      expect(repository.disarmArmed).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
      expect(response).toMatchObject({
        status: 'DISARMED',
        disarmedBy: USER_ID,
        disarmedAt: '2026-10-30T11:00:00.000Z',
      });
    });

    it('sin captura ARMED responde 404 EXPERIMENT_CAPTURE_NOT_ARMED', async () => {
      const { repository, service } = build();
      repository.disarmArmed.mockResolvedValue(null);

      const error = await service.disarmCurrent(PROJECT_ID, USER_ID).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({ code: ErrorCode.EXPERIMENT_CAPTURE_NOT_ARMED, status: 404 });
    });
  });

  describe('list', () => {
    it('pide limit + 1 filas y devuelve nextCursor solo si hay más', async () => {
      const { repository, service } = build();
      repository.list.mockResolvedValue([capture({ id: 'c-2' }), capture({ id: 'c-1' }), capture({ id: 'c-0' })]);

      const page = await service.list(PROJECT_ID, { limit: 2 });

      expect(repository.list).toHaveBeenCalledWith(PROJECT_ID, 3, undefined);
      expect(page.items.map((item) => item.captureId)).toEqual(['c-2', 'c-1']);
      expect(page.nextCursor).toBe('c-1');
    });

    it('sin filas adicionales no devuelve cursor y pasa el cursor recibido', async () => {
      const { repository, service } = build();
      repository.list.mockResolvedValue([capture({ id: 'c-1' })]);

      const page = await service.list(PROJECT_ID, { cursor: 'c-2' });

      expect(repository.list).toHaveBeenCalledWith(PROJECT_ID, 21, 'c-2');
      expect(page).toEqual({ items: [expect.objectContaining({ captureId: 'c-1' })], nextCursor: null });
    });
  });

  describe('DTOs', () => {
    it('la referencia de Run solo existe cuando la captura tiene reservedAt', () => {
      const reservedAt = new Date('2026-10-30T12:00:00.000Z');

      expect(toExperimentCaptureReservationResponse({ id: 'c-1', reservedAt })).toEqual({
        captureId: 'c-1',
        reservedAt: '2026-10-30T12:00:00.000Z',
      });
      expect(toExperimentCaptureReservationResponse({ id: 'c-1', reservedAt: null })).toBeNull();
      expect(toExperimentCaptureReservationResponse(null)).toBeNull();
      expect(toExperimentCaptureReservationResponse(undefined)).toBeNull();
    });

    it('la respuesta de captura usa los nombres del contrato (armedBy, disarmedBy)', () => {
      const response = toExperimentCaptureResponse(capture({ disarmedByUserId: 'u-2', disarmedAt: ARMED_AT }));

      expect(response.armedBy).toBe(USER_ID);
      expect(response.disarmedBy).toBe('u-2');
      expect(response).not.toHaveProperty('armedByUserId');
    });
  });
});
