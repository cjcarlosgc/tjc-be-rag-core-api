import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { FunctionalKnowledgeStatus } from '../../generated/prisma/client.js';

export class ListFunctionalKnowledgeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(FunctionalKnowledgeStatus)
  status?: FunctionalKnowledgeStatus;
}
