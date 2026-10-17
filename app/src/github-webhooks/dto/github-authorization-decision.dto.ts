import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const GITHUB_ID = /^[1-9]\d{0,19}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class GithubOrganizationMembershipDto {
  @IsIn(['active', 'pending'])
  state!: 'active' | 'pending';

  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}

export class GithubRepositoryFactDto {
  @IsString()
  @Matches(GITHUB_ID)
  repositoryId!: string;

  @IsString()
  @Matches(REPOSITORY_NAME)
  repositoryName!: string;

  @IsString()
  @Matches(GITHUB_ID)
  ownerId!: string;

  @IsIn(['User', 'Organization'])
  ownerType!: 'User' | 'Organization';

  @IsIn(['admin', 'maintain', 'write', 'triage', 'read', 'none'])
  permission!: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

  @IsOptional()
  @IsString()
  @Matches(GITHUB_ID)
  installationId?: string;

  @IsBoolean()
  installationActive!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => GithubOrganizationMembershipDto)
  organizationMembership?: GithubOrganizationMembershipDto;
}

export class GithubAuthorizationDecisionDto {
  @IsIn(['VIEW_APP_INFO', 'DISCOVER_REPOSITORIES', 'VERIFY_REPOSITORY_ACCESS', 'LIST_REPOSITORY_BRANCHES'])
  action!: 'VIEW_APP_INFO' | 'DISCOVER_REPOSITORIES' | 'VERIFY_REPOSITORY_ACCESS' | 'LIST_REPOSITORY_BRANCHES';

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @Matches(GITHUB_ID)
  githubUserId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GithubRepositoryFactDto)
  repositories?: GithubRepositoryFactDto[];

  @IsOptional()
  @IsString()
  @Matches(GITHUB_ID)
  repositoryId?: string;

  @IsOptional()
  @IsString()
  @Matches(REPOSITORY_NAME)
  repositoryName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  integrationBranch?: string;
}
