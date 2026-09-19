import { Controller, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GithubWebhooksService } from './github-webhooks.service.js';
import type { GitHubWebhookAcceptedResponse } from './dto/webhook-accepted.response.js';
import { Public } from '../common/auth/public.decorator.js';

/**
 * Sin DTO/ValidationPipe: el body es el payload real de GitHub (decenas de
 * campos no declarados) y la verificación de integridad es la firma HMAC
 * sobre el body crudo, no una validación de forma. `@Public()` porque
 * GitHub no envía un access token Supabase; la firma HMAC es la autenticación.
 */
@Controller('integrations/github/webhooks')
export class GithubWebhooksController {
  constructor(private readonly githubWebhooksService: GithubWebhooksService) {}

  @Public()
  @Post()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GitHubWebhookAcceptedResponse> {
    const result = await this.githubWebhooksService.handle({
      rawBody: req.rawBody,
      signatureHeader: req.header('x-hub-signature-256'),
      deliveryId: req.header('x-github-delivery'),
      eventName: req.header('x-github-event'),
      payload: req.body,
    });

    res.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }
}
