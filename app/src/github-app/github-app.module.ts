import { Module } from '@nestjs/common';
import { GithubAppAuthService } from './github-app-auth.service.js';
import { GithubRepositoryContentService } from './github-repository-content.service.js';
import { GithubChecksService } from './github-checks.service.js';
import { GithubGitDataService } from './github-git-data.service.js';

@Module({
  providers: [GithubAppAuthService, GithubRepositoryContentService, GithubChecksService, GithubGitDataService],
  exports: [GithubAppAuthService, GithubRepositoryContentService, GithubChecksService, GithubGitDataService],
})
export class GithubAppModule {}
