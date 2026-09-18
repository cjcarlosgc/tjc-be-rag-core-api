import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListActionRequiredQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
