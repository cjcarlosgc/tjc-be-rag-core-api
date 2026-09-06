import { HttpStatus, Injectable } from '@nestjs/common';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import type { TestTarget } from '../generated/prisma/client.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { GenerationMode } from './dto/generation-mode.js';

@Injectable()
export class GapAnalyzer {
  constructor(private readonly testTargetsRepository: TestTargetsRepository) {}

  async resolve(
    projectVersionId: string,
    mode: GenerationMode,
    targetId: string | undefined,
  ): Promise<TestTarget[]> {
    switch (mode) {
      case 'TARGET': {
        const target = await this.requireTarget(targetId, mode);

        if (target.targetType === 'CLASS') {
          throw new AppException(
            ErrorCode.INVALID_GENERATION_TARGET,
            'El modo TARGET requiere un target METHOD o FUNCTION.',
            HttpStatus.BAD_REQUEST,
          );
        }

        return [target];
      }

      case 'CLASS_ALL':
      case 'CLASS_MISSING': {
        const classTarget = await this.requireTarget(targetId, mode);

        if (classTarget.targetType !== 'CLASS') {
          throw new AppException(
            ErrorCode.INVALID_GENERATION_TARGET,
            `El modo ${mode} requiere un target CLASS.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const methods = await this.testTargetsRepository.findMethodsOfClass(
          projectVersionId,
          classTarget.symbolName,
        );

        return mode === 'CLASS_MISSING' ? methods.filter((method) => !method.hasTest) : methods;
      }

      case 'PROJECT_MISSING':
      case 'PROJECT_ALL': {
        if (targetId) {
          throw new AppException(
            ErrorCode.INVALID_GENERATION_TARGET,
            `El modo ${mode} no acepta targetId.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const all = await this.testTargetsRepository.findTestableTargets(projectVersionId);

        return mode === 'PROJECT_MISSING' ? all.filter((target) => !target.hasTest) : all;
      }
    }
  }

  private async requireTarget(
    targetId: string | undefined,
    mode: GenerationMode,
  ): Promise<TestTarget> {
    if (!targetId) {
      throw new AppException(
        ErrorCode.INVALID_GENERATION_TARGET,
        `El modo ${mode} requiere targetId.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const target = await this.testTargetsRepository.findById(targetId);

    if (!target) {
      throw new AppException(
        ErrorCode.UNRESOLVABLE_TARGET,
        `No existe el target ${targetId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return target;
  }
}
