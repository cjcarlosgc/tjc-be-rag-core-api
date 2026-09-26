import { Body, Controller, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth/public.decorator.js';
import type { GitHubWebhookAcceptedResponse } from './dto/webhook-accepted.response.js';
import { parseNormalizedWebhookEvent } from './dto/normalized-webhook-event.js';
import { GithubIntegrationAuthGuard } from './github-integration-auth.guard.js';
import { GithubWebhooksService } from './github-webhooks.service.js';

@Controller('internal/v1/github')
@Public()
@UseGuards(GithubIntegrationAuthGuard)
export class GithubWebhooksController {
  constructor(private readonly githubWebhooksService: GithubWebhooksService) {}

  @Post('webhook-events')
  async handle(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GitHubWebhookAcceptedResponse> {
    const event = parseNormalizedWebhookEvent(body);
    const result = await this.githubWebhooksService.handle(event);
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }
}
