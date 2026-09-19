import { IsNotEmpty, IsString, Matches } from 'class-validator';

const OWNER_REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export class VerifyGitHubAppAccessRequestDto {
  @IsString()
  @IsNotEmpty()
  repositoryId!: string;

  @IsString()
  @Matches(OWNER_REPO_PATTERN, { message: 'repositoryName debe tener la forma owner/repo.' })
  repositoryName!: string;
}

export type GitHubAppAccessStatus = 'AUTHORIZED' | 'NOT_AUTHORIZED';

export interface GitHubAppAccessResponse {
  repositoryId: string;
  repositoryName: string;
  status: GitHubAppAccessStatus;
  installationId: string | null;
  app: { displayName: string; configureUrl: string };
}
