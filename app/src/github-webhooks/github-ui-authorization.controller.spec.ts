import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { GithubIntegrationAuthGuard } from './github-integration-auth.guard.js';
import { GithubUiAuthorizationController } from './github-ui-authorization.controller.js';
import { GithubUiAuthorizationService } from './github-ui-authorization.service.js';

const serviceToken = 'test-only-gh-to-core-token';

describe('Core internal GitHub authorization callback', () => {
  let app: INestApplication;
  const authorization = { decide: vi.fn() };
  const config = { get: vi.fn((key: string) => key === 'GITHUB_INTEGRATION_TO_CORE_TOKEN' ? serviceToken : undefined) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GithubUiAuthorizationController],
      providers: [
        GithubIntegrationAuthGuard,
        { provide: GithubUiAuthorizationService, useValue: authorization },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  it('requires both independent credentials and marks the decision as non-cacheable', async () => {
    authorization.decide.mockResolvedValueOnce({ decision: 'ALLOW' });
    await request(app.getHttpServer())
      .post('/internal/v1/github/authorization-decisions')
      .set('Authorization', `Bearer ${serviceToken}`)
      .set('X-Platform-User-Token', 'Bearer platform-jwt')
      .send({ action: 'VIEW_APP_INFO' })
      .expect(200, { decision: 'ALLOW' })
      .expect('Cache-Control', 'no-store');
    expect(authorization.decide).toHaveBeenCalledWith('platform-jwt', expect.objectContaining({ action: 'VIEW_APP_INFO' }));

    await request(app.getHttpServer())
      .post('/internal/v1/github/authorization-decisions')
      .set('Authorization', `Bearer ${serviceToken}`)
      .send({ action: 'VIEW_APP_INFO' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/v1/github/authorization-decisions')
      .set('Authorization', 'Bearer wrong-service-token')
      .set('X-Platform-User-Token', 'Bearer platform-jwt')
      .send({ action: 'VIEW_APP_INFO' })
      .expect(401);
    expect(authorization.decide).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown authorization facts', async () => {
    authorization.decide.mockClear();
    await request(app.getHttpServer())
      .post('/internal/v1/github/authorization-decisions')
      .set('Authorization', `Bearer ${serviceToken}`)
      .set('X-Platform-User-Token', 'Bearer platform-jwt')
      .send({ action: 'VIEW_APP_INFO', installationId: 'browser-controlled' })
      .expect(400);
    expect(authorization.decide).not.toHaveBeenCalled();
  });
});
