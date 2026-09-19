import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { FunctionalAnswerChoice } from '../../generated/prisma/client.js';

export class ConflictResolutionDto {
  @IsUUID()
  conflictId!: string;

  @IsIn(['SUPERSEDE', 'KEEP_EXISTING'])
  action!: 'SUPERSEDE' | 'KEEP_EXISTING';
}

export class SubmitFunctionalAnswerRequestDto {
  @IsEnum(FunctionalAnswerChoice)
  choice!: FunctionalAnswerChoice;

  @IsOptional()
  @IsString()
  answer?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConflictResolutionDto)
  conflictResolution?: ConflictResolutionDto;
}
