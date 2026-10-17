import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateExperimentDto } from './create-experiment.dto.js';

const validRequest = {
  analysisRunId: '11111111-1111-4111-8111-111111111111',
  symbolFilePath: 'src/example.ts',
  symbolQualifiedName: 'Example.run',
};

describe('CreateExperimentDto', () => {
  it('accepts the OE5 V3 request shape', async () => {
    const dto = plainToInstance(CreateExperimentDto, { ...validRequest, repetitions: 3 });

    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual([]);
  });

  it.each([
    ['projectId', '11111111-1111-4111-8111-111111111112'],
    ['targetId', '11111111-1111-4111-8111-111111111113'],
  ])('rejects legacy field %s instead of trusting a client-selected resource', async (field, value) => {
    const dto = plainToInstance(CreateExperimentDto, { ...validRequest, [field]: value });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('accepts a normalized relative POSIX path', async () => {
    const dto = plainToInstance(CreateExperimentDto, validRequest);

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    ['/src/example.ts', 'absolute POSIX path'],
    ['src/../example.ts', 'traversal'],
    ['src//example.ts', 'empty segment'],
    ['src/./example.ts', 'dot segment'],
    ['src\\example.ts', 'backslash'],
  ])('returns HTTP 400 for %s (%s)', async (symbolFilePath) => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const dto = { ...validRequest, symbolFilePath };

    const error = await pipe
      .transform(dto, { type: 'body', metatype: CreateExperimentDto, data: '' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
  });
});
