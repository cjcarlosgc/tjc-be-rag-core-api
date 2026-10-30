import { HttpStatus, Injectable } from '@nestjs/common';
import type { Page } from '../common/dto/page.response.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import {
  toExperimentCaptureResponse,
  type ExperimentCaptureResponse,
} from './dto/experiment-capture.response.js';
import {
  ExperimentCaptureAlreadyArmedError,
  ExperimentCapturesRepository,
} from './persistence/experiment-captures.repository.js';

const DEFAULT_PAGE_LIMIT = 20;

/**
 * Captura armada de experimentación (HU18, INTEROP-2.25 §6.17). El rol mínimo lo exige el guard de la ruta
 * (Maintainer para armar y desarmar, Reader para listar); el servicio no vuelve a comprobarlo.
 */
@Injectable()
export class ExperimentCapturesService {
  constructor(private readonly repository: ExperimentCapturesRepository) {}

  async arm(projectId: string, userId: string): Promise<ExperimentCaptureResponse> {
    try {
      return toExperimentCaptureResponse(await this.repository.arm(projectId, userId));
    } catch (error) {
      if (error instanceof ExperimentCaptureAlreadyArmedError) {
        throw new AppException(
          ErrorCode.EXPERIMENT_CAPTURE_ALREADY_ARMED,
          `El proyecto "${projectId}" ya tiene una captura de experimentación armada.`,
          HttpStatus.CONFLICT,
        );
      }

      throw error;
    }
  }

  async list(projectId: string, query: { cursor?: string; limit?: number }): Promise<Page<ExperimentCaptureResponse>> {
    const take = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.repository.list(projectId, take + 1, query.cursor);
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;

    return {
      items: items.map(toExperimentCaptureResponse),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async disarmCurrent(projectId: string, userId: string): Promise<ExperimentCaptureResponse> {
    const disarmed = await this.repository.disarmArmed(projectId, userId);

    if (!disarmed) {
      throw new AppException(
        ErrorCode.EXPERIMENT_CAPTURE_NOT_ARMED,
        `El proyecto "${projectId}" no tiene una captura de experimentación armada.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return toExperimentCaptureResponse(disarmed);
  }
}
