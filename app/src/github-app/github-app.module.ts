import { Module } from '@nestjs/common';
import { GithubAppAuthService } from './github-app-auth.service.js';
import { GithubRepositoryContentService } from './github-repository-content.service.js';
import { GithubChecksService } from './github-checks.service.js';

@Module({
  providers: [GithubAppAuthService, GithubRepositoryContentService, GithubChecksService],
  exports: [GithubAppAuthService, GithubRepositoryContentService, GithubChecksService],
})
export class GithubAppModule {}
