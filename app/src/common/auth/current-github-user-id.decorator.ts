import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** `githubUserId` numérico (texto) resuelto por el guard tras validar el JWT. */
export const CurrentGithubUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.githubUserId as string;
});
