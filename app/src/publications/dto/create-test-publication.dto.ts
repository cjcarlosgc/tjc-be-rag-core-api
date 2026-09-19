import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class CreateTestPublicationRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  proposalIds!: string[];
}
