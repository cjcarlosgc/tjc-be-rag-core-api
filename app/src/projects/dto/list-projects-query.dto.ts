import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListProjectsQueryDto extends PaginationQueryDto {
  /** `WorkspaceRefResponse.id`; hasta el corte 3 solo el workspace personal (el de una organización responde `404`). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;
}
