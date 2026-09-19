import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { AnalysisRunStatus } from '../../generated/prisma/client.js';

export class ListAnalysisRunsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AnalysisRunStatus)
  status?: AnalysisRunStatus;
}
