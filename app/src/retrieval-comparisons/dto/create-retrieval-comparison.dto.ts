import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import type { CreateRetrievalComparisonRequest } from '../retrieval-comparisons.service.js';

/** Máximo de elementos de la verdad de terreno (INTEROP-2.7 §6.15, DEC de validación de cuerpo). */
export const MAX_GROUND_TRUTH_ITEMS = 200;

export class RetrievalGroundTruthItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  filePath!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  symbolQualifiedName!: string;
}

/** Cuerpo de `POST /retrieval-comparisons` (INTEROP-2.7 §6.15). Los campos desconocidos se rechazan (400). */
export class CreateRetrievalComparisonDto implements CreateRetrievalComparisonRequest {
  @IsUUID()
  analysisRunId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  symbolFilePath!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  symbolQualifiedName!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GROUND_TRUTH_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => RetrievalGroundTruthItemDto)
  groundTruth?: RetrievalGroundTruthItemDto[];
}
