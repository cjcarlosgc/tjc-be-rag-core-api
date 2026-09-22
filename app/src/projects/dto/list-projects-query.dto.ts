import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListProjectsQueryDto extends PaginationQueryDto {
  /** `WorkspaceRefResponse.id`; un valor que no es un workspace del usuario responde `404 WORKSPACE_NOT_FOUND`. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;
}
