import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateProjectDto } from './create-project.dto.js';

const check = (plain: unknown) => {
  const dto = plainToInstance(CreateProjectDto, plain);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true }).then((errors) => ({ dto, errors }));
};

describe('CreateProjectDto', () => {
  it('trims the name before validating (same as UpdateProjectDto)', async () => {
    const { dto, errors } = await check({ name: '  Mi proyecto  ' });

    expect(errors).toEqual([]);
    expect(dto.name).toBe('Mi proyecto');
  });

  it.each(['', '   ', '\t\n '])('rejects a name that is empty or only whitespace (%j)', async (name) => {
    const { errors } = await check({ name });

    expect(errors.map((error) => error.property)).toContain('name');
  });

  it('rejects a non-string name and a name longer than 200 characters after trimming', async () => {
    expect((await check({ name: 5 })).errors).not.toEqual([]);
    expect((await check({ name: 'x'.repeat(201) })).errors).not.toEqual([]);
    expect((await check({ name: ` ${'x'.repeat(200)} ` })).errors).toEqual([]);
  });
});
