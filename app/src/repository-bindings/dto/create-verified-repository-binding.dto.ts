import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const GITHUB_ID = /^[1-9]\d{0,19}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class CreateVerifiedRepositoryBindingDto {
  @IsString()
  @Matches(GITHUB_ID)
  repositoryId!: string;

  @IsString()
  @Matches(REPOSITORY_NAME)
  repositoryName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  integrationBranch!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  authorizationEvidence!: string;
}
