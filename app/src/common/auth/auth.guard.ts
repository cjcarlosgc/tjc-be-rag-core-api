import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { AUTH_TOKEN_VERIFIER, IS_PUBLIC_KEY } from './auth.constants.js';
import { InvalidTokenError, type TokenVerifierPort } from './token-verifier.port.js';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Inject(AUTH_TOKEN_VERIFIER) private readonly verifier: TokenVerifierPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isWs = context.getType<'http' | 'ws'>() === 'ws';
    const token = isWs ? this.extractWsToken(context) : this.extractHttpToken(context);

    if (!token) {
      this.fail(isWs, ErrorCode.AUTH_REQUIRED, 'Falta un access token válido.');
    }

    if (this.config.get<boolean>('AUTH_BYPASS_ENABLED', false)) {
      this.setUserId(context, isWs, this.config.get<string>('AUTH_BYPASS_USER_ID', 'local-dev-user'));
      return true;
    }

    try {
      const { userId } = await this.verifier.verify(token as string);
      this.setUserId(context, isWs, userId);
      return true;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        this.fail(isWs, ErrorCode.INVALID_ACCESS_TOKEN, 'El access token es inválido o expiró.');
      }
      throw error;
    }
  }

  private extractHttpToken(context: ExecutionContext): string | null {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      return null;
    }
    return header.slice(BEARER_PREFIX.length).trim() || null;
  }

  private extractWsToken(context: ExecutionContext): string | null {
    const client = context.switchToWs().getClient<Socket>();
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken;
    }
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
      return header.slice(BEARER_PREFIX.length).trim() || null;
    }
    return null;
  }

  private setUserId(context: ExecutionContext, isWs: boolean, userId: string): void {
    if (isWs) {
      const client = context.switchToWs().getClient<Socket>();
      client.data.userId = userId;
      return;
    }
    const request = context.switchToHttp().getRequest<Request>();
    request.userId = userId;
  }

  private fail(isWs: boolean, code: ErrorCode, message: string): never {
    if (isWs) {
      throw new WsException({ code, message });
    }
    throw new AppException(code, message, HttpStatus.UNAUTHORIZED);
  }
}
