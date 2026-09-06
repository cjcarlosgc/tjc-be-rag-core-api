import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code.enum.js';

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    statusCode: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, statusCode);
  }
}
