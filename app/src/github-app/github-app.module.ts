import { Module } from '@nestjs/common';
import { GithubAppAuthService } from './github-app-auth.service.js';
import { GithubRepositoryContentService } from './github-repository-content.service.js';

@Module({
  providers: [GithubAppAuthService, GithubRepositoryContentService],
  exports: [GithubAppAuthService, GithubRepositoryContentService],
})
export class GithubAppModule {}
