import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { IS_PUBLIC_KEY } from './auth.constants.js';
import { extractHandshakeToken } from './handshake-token.util.js';
import { SessionAuthService, type SessionIdentity } from './session-auth.service.js';
import { InvalidTokenError } from './token-verifier.port.js';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionAuth: SessionAuthService,
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

    try {
      this.setIdentity(context, isWs, await this.sessionAuth.authenticate(token as string));
      return true;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        this.fail(isWs, ErrorCode.INVALID_ACCESS_TOKEN, 'El access token es inválido o expiró.');
      }
      if (isWs && error instanceof AppException) {
        // GITHUB_IDENTITY_REQUIRED / IDENTITY_UNAVAILABLE en un mensaje WebSocket.
        throw new WsException({ code: error.code, message: error.message });
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
    return extractHandshakeToken(context.switchToWs().getClient<Socket>().handshake);
  }

  private setIdentity(context: ExecutionContext, isWs: boolean, identity: SessionIdentity): void {
    if (isWs) {
      const client = context.switchToWs().getClient<Socket>();
      client.data.userId = identity.userId;
      client.data.githubUserId = identity.githubUserId;
      return;
    }
    const request = context.switchToHttp().getRequest<Request>();
    request.userId = identity.userId;
    request.githubUserId = identity.githubUserId;
  }

  private fail(isWs: boolean, code: ErrorCode, message: string): never {
    if (isWs) {
      throw new WsException({ code, message });
    }
    throw new AppException(code, message, HttpStatus.UNAUTHORIZED);
  }
}
