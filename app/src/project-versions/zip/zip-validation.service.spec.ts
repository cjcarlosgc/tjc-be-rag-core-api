import { describe, expect, it } from 'vitest';
import { ZipValidationService } from './zip-validation.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

function makeConfigService(maxSizeBytes = 1024) {
  return { get: () => maxSizeBytes } as never;
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'project.zip',
    encoding: '7bit',
    mimetype: 'application/zip',
    size: 10,
    buffer: Buffer.from('zip-bytes'),
    ...overrides,
  } as Express.Multer.File;
}

describe('ZipValidationService', () => {
  it('throws ZIP_REQUIRED when no file is provided', () => {
    const service = new ZipValidationService(makeConfigService());

    try {
      service.assertValidUpload(undefined);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.ZIP_REQUIRED);
    }
  });

  it('throws INVALID_ZIP for an empty file', () => {
    const service = new ZipValidationService(makeConfigService());

    try {
      service.assertValidUpload(makeFile({ size: 0 }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.INVALID_ZIP);
    }
  });

  it('throws ZIP_TOO_LARGE when the file exceeds the configured limit', () => {
    const service = new ZipValidationService(makeConfigService(5));

    try {
      service.assertValidUpload(makeFile({ size: 10 }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.ZIP_TOO_LARGE);
    }
  });

  it('throws INVALID_ZIP when the extension is not .zip', () => {
    const service = new ZipValidationService(makeConfigService());

    try {
      service.assertValidUpload(makeFile({ originalname: 'project.rar' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.INVALID_ZIP);
    }
  });

  it('accepts a well-formed zip upload', () => {
    const service = new ZipValidationService(makeConfigService());

    expect(() => service.assertValidUpload(makeFile())).not.toThrow();
  });
});
