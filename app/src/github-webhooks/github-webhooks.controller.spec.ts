import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubWebhooksController } from './github-webhooks.controller.js';
import { GithubIntegrationAuthGuard } from './github-integration-auth.guard.js';
import { GithubWebhooksService } from './github-webhooks.service.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { HttpStatus } from '@nestjs/common';

const TOKEN = 'test-gh-to-core-token';

function pullRequestEvent() {
  return {
    schemaVersion: 1,
    deliveryId: 'delivery-pr-1',
    eventName: 'pull_request',
    action: 'opened',
    receivedAt: '2026-09-25T20:00:00.000Z',
    data: {
      kind: 'PULL_REQUEST',
      repository: { id: '123', fullName: 'acme/widgets' },
      installationId: '999',
      pullRequestNumber: 42,
      pullRequest: {
        title: 'Add feature',
        draft: false,
        merged: false,
        base: { ref: 'develop', sha: 'base-sha' },
        head: { ref: 'feature', sha: 'head-sha' },
        userLogin: 'octocat',
      },
    },
  };
}

function eventFor(eventName: string, data: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    deliveryId: `delivery-${eventName}`,
    eventName,
    action: 'changed',
    receivedAt: '2026-09-25T20:00:00.000Z',
    data,
  };
}

describe('Core internal GitHub webhook receiver', () => {
  let app: INestApplication;
  const service = { handle: vi.fn() };
  const config = { get: vi.fn((key: string) => key === 'GITHUB_INTEGRATION_TO_CORE_TOKEN' ? TOKEN : undefined) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GithubWebhooksController],
      providers: [
        GithubIntegrationAuthGuard,
        { provide: GithubWebhooksService, useValue: service },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockImplementation((key: string) => key === 'GITHUB_INTEGRATION_TO_CORE_TOKEN' ? TOKEN : undefined);
    service.handle.mockImplementation(async (event: { deliveryId: string }) => ({
      deliveryId: event.deliveryId,
      accepted: true,
      duplicate: false,
      analysisRunId: null,
    }));
  });

  const send = (body: unknown, token?: string) => {
    const call = request(app.getHttpServer()).post('/internal/v1/github/webhook-events').send(body);
    return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  };

  it('accepts a new PR as 202 with the stable response body', async () => {
    const event = pullRequestEvent();
    await send(event, TOKEN).expect(202, {
      deliveryId: event.deliveryId,
      accepted: true,
      duplicate: false,
      analysisRunId: null,
    });
    expect(service.handle).toHaveBeenCalledWith(event);
  });

  it('returns 200 only when the persisted PR delivery is a duplicate', async () => {
    const event = pullRequestEvent();
    service.handle.mockResolvedValueOnce({
      deliveryId: event.deliveryId,
      accepted: true,
      duplicate: true,
      analysisRunId: 'run-1',
    });

    await send(event, TOKEN).expect(200, {
      deliveryId: event.deliveryId,
      accepted: true,
      duplicate: true,
      analysisRunId: 'run-1',
    });
  });

  it.each([
    ['installation', { kind: 'INSTALLATION', installationId: '999', account: { id: '42', type: 'Organization' } }],
    ['installation_repositories', { kind: 'INSTALLATION_REPOSITORIES', installationId: '999', added: [], removed: [] }],
    ['repository', { kind: 'REPOSITORY', repository: { id: '123', fullName: 'acme/widgets', owner: null }, installationId: null }],
    ['member', { kind: 'MEMBER', memberId: '5', repositoryId: '123' }],
    ['membership', { kind: 'MEMBERSHIP', memberId: '5', organizationId: '42' }],
    ['organization', { kind: 'ORGANIZATION', organizationId: '42', organizationLogin: 'acme', membershipUserId: '5' }],
    ['team', { kind: 'TEAM', repositoryId: '123', organizationId: '42' }],
    ['ping', { kind: 'IGNORED' }],
  ])('accepts normalized %s events as 202', async (eventName, data) => {
    const event = eventFor(eventName, data as Record<string, unknown>);
    await send(event, TOKEN).expect(202);
    expect(service.handle).toHaveBeenCalledWith(event);
  });

  it.each([
    ['invalid schema version', { ...pullRequestEvent(), schemaVersion: 2 }],
    ['missing delivery metadata', { ...pullRequestEvent(), deliveryId: '' }],
    ['unallowlisted envelope field', { ...pullRequestEvent(), payload: { secret: true } }],
    ['unallowlisted nested payload field', { ...pullRequestEvent(), data: { ...pullRequestEvent().data, pullRequest: { ...pullRequestEvent().data.pullRequest, user: { role: 'admin' } } } }],
    ['kind/event mismatch', { ...pullRequestEvent(), eventName: 'repository' }],
  ])('rejects %s before domain processing', async (_label, event) => {
    await send(event, TOKEN).expect(400);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid bearer credentials', async () => {
    await send(pullRequestEvent()).expect(401);
    await send(pullRequestEvent(), 'wrong-token').expect(401);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the service credential is not configured', async () => {
    config.get.mockReturnValueOnce(undefined);
    await send(pullRequestEvent(), TOKEN).expect(503);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it('propagates retryable Core processing failures instead of acknowledging them', async () => {
    service.handle.mockRejectedValueOnce(new AppException(
      ErrorCode.GITHUB_WEBHOOK_UNAVAILABLE,
      'retry later',
      HttpStatus.SERVICE_UNAVAILABLE,
    ));
    await send(pullRequestEvent(), TOKEN).expect(503);
  });
});
