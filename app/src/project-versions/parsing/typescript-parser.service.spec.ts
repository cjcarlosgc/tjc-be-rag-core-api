import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptParserService } from './typescript-parser.service.js';

describe('TypeScriptParserService', () => {
  let dir: string;
  const parser = new TypeScriptParserService();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ts-parser-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts one chunk per top-level class and function', async () => {
    await writeFile(
      join(dir, 'sample.ts'),
      [
        'export class Greeter {',
        '  greet(): string {',
        '    return "hi";',
        '  }',
        '}',
        '',
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
      ].join('\n'),
    );

    const chunks = parser.parse(dir, ['sample.ts']);

    expect(chunks).toHaveLength(2);
    expect(chunks.find((chunk) => chunk.symbolKind === 'CLASS')?.symbolName).toBe('Greeter');
    expect(chunks.find((chunk) => chunk.symbolKind === 'FUNCTION')?.symbolName).toBe('add');
  });

  it('falls back to a single FILE chunk when there are no top-level declarations', async () => {
    await writeFile(join(dir, 'constants.ts'), 'export const VALUE = 42;\n');

    const chunks = parser.parse(dir, ['constants.ts']);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ symbolKind: 'FILE', symbolName: null });
  });
});
