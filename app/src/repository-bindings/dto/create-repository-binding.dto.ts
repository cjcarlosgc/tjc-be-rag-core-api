import { IsNotEmpty, IsString, Matches } from 'class-validator';

const OWNER_REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export class CreateRepositoryBindingRequestDto {
  @IsString()
  @IsNotEmpty()
  repositoryId!: string;

  @IsString()
  @Matches(OWNER_REPO_PATTERN, { message: 'repositoryName debe tener la forma owner/repo.' })
  repositoryName!: string;

  @IsString()
  @IsNotEmpty()
  integrationBranch!: string;
}
