import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

@Injectable()
export class GithubIntegrationAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('GITHUB_INTEGRATION_TO_CORE_TOKEN');
    if (!expected) {
      throw new AppException(
        ErrorCode.GITHUB_WEBHOOK_UNAVAILABLE,
        'La credencial interna de GitHub Integration no está configurada.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const authorization = context.switchToHttp().getRequest<Request>().headers.authorization;
    const supplied = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (!constantTimeTokenMatch(supplied, expected)) {
      throw new AppException(ErrorCode.AUTH_REQUIRED, 'La credencial interna no es válida.', HttpStatus.UNAUTHORIZED);
    }

    return true;
  }
}

function constantTimeTokenMatch(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}
