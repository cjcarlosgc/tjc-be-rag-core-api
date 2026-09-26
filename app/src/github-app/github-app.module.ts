import { Module } from '@nestjs/common';
import { GithubAppAuthService } from './github-app-auth.service.js';
import { GithubRepositoryContentService } from './github-repository-content.service.js';
import { GithubChecksService } from './github-checks.service.js';
import { GithubGitDataService } from './github-git-data.service.js';
import { GITHUB_ACCESS_PORT } from './github-access.port.js';
import { GithubAccessHttpAdapter } from './github-access-http.adapter.js';
import { GITHUB_INTEGRATION_FETCH, GithubIntegrationClient } from './github-integration.client.js';

@Module({
  providers: [
    { provide: GITHUB_INTEGRATION_FETCH, useValue: fetch },
    GithubIntegrationClient,
    GithubAppAuthService,
    GithubRepositoryContentService,
    GithubChecksService,
    GithubGitDataService,
    { provide: GITHUB_ACCESS_PORT, useClass: GithubAccessHttpAdapter },
  ],
  exports: [
    GithubIntegrationClient,
    GithubAppAuthService,
    GithubRepositoryContentService,
    GithubChecksService,
    GithubGitDataService,
    GITHUB_ACCESS_PORT,
  ],
})
export class GithubAppModule {}
