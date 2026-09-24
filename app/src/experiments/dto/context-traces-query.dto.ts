import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ExperimentStrategy } from '../../generated/prisma/enums.js';

export class ListContextTracesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ExperimentStrategy)
  strategy?: ExperimentStrategy;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  repetition?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  includeSuperseded?: boolean;
}

export class ListDiscoveredFilesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  step?: number;
}
