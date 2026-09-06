import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

@Injectable()
export class ZipValidationService {
  constructor(private readonly configService: ConfigService) {}

  assertValidUpload(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
    if (!file) {
      throw new AppException(
        ErrorCode.ZIP_REQUIRED,
        'Se requiere un archivo ZIP en el campo "file".',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (file.size === 0) {
      throw new AppException(
        ErrorCode.INVALID_ZIP,
        'El archivo ZIP está vacío.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const maxSizeBytes = this.configService.get<number>('INDEXING_MAX_ZIP_SIZE_BYTES', 52_428_800);

    if (file.size > maxSizeBytes) {
      throw new AppException(
        ErrorCode.ZIP_TOO_LARGE,
        `El archivo ZIP excede el tamaño máximo permitido (${maxSizeBytes} bytes).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const hasZipExtension = file.originalname.toLowerCase().endsWith('.zip');

    if (!hasZipExtension || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new AppException(
        ErrorCode.INVALID_ZIP,
        'El archivo debe ser un ZIP válido (extensión .zip).',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
