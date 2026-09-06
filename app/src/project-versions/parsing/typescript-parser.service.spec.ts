import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptParserService } from './typescript-parser.service.js';

function makeConfigService(maxChunkTokens = 1500) {
  return { get: () => maxChunkTokens } as never;
}

describe('TypeScriptParserService', () => {
  let dir: string;
  const parser = new TypeScriptParserService(makeConfigService());

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ts-parser-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts a CLASS chunk, one METHOD chunk per method, and one FUNCTION chunk', async () => {
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

    expect(chunks).toHaveLength(3);

    const classChunk = chunks.find((chunk) => chunk.symbolKind === 'CLASS');
    expect(classChunk).toMatchObject({ symbolName: 'Greeter', parentSymbolName: null });
    expect(classChunk?.content).toContain('greet(): string');

    const methodChunk = chunks.find((chunk) => chunk.symbolKind === 'METHOD');
    expect(methodChunk).toMatchObject({ symbolName: 'greet', parentSymbolName: 'Greeter' });

    const functionChunk = chunks.find((chunk) => chunk.symbolKind === 'FUNCTION');
    expect(functionChunk).toMatchObject({ symbolName: 'add', parentSymbolName: null });
  });

  it('emits a CONSTRUCTOR chunk with parentSymbolName pointing to the class', async () => {
    await writeFile(
      join(dir, 'service.ts'),
      [
        'export class Repo {',
        '  constructor(private id: string) {}',
        '  find(): string {',
        '    return this.id;',
        '  }',
        '}',
      ].join('\n'),
    );

    const chunks = parser.parse(dir, ['service.ts']);
    const ctorChunk = chunks.find((chunk) => chunk.symbolKind === 'CONSTRUCTOR');

    expect(ctorChunk).toMatchObject({ symbolName: 'constructor', parentSymbolName: 'Repo' });
  });

  it('falls back to a single FILE chunk when there are no top-level declarations', async () => {
    await writeFile(join(dir, 'constants.ts'), 'export const VALUE = 42;\n');

    const chunks = parser.parse(dir, ['constants.ts']);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ symbolKind: 'FILE', symbolName: null, parentSymbolName: null });
  });

  it('every chunk carries a single part, a real tokenCount and no importsUsed when nothing is referenced', async () => {
    await writeFile(join(dir, 'plain.ts'), 'export function noop(): void {}\n');

    const [chunk] = parser.parse(dir, ['plain.ts']);

    expect(chunk.partIndex).toBe(1);
    expect(chunk.partsTotal).toBe(1);
    expect(chunk.tokenCount).toBeGreaterThan(0);
    expect(chunk.importsUsed).toEqual([]);
  });

  it('records importsUsed only for modules whose imported symbol is referenced in the chunk', async () => {
    await writeFile(
      join(dir, 'consumer.ts'),
      [
        "import { helper } from './helper.js';",
        "import { unusedThing } from './unused.js';",
        '',
        'export function run(): string {',
        '  return helper();',
        '}',
      ].join('\n'),
    );

    const [chunk] = parser.parse(dir, ['consumer.ts']);

    expect(chunk.importsUsed).toEqual(['./helper.js']);
  });

  it('splits an oversized function into ordered, non-overlapping parts without duplicating content', async () => {
    const statements = Array.from(
      { length: 40 },
      (_, index) => `  const line${index} = ${index}; // padding statement to inflate token count`,
    );
    await writeFile(
      join(dir, 'big.ts'),
      ['export function big(): number {', ...statements, '  return line0;', '}'].join('\n'),
    );

    const tinyBudgetParser = new TypeScriptParserService(makeConfigService(40));
    const chunks = tinyBudgetParser.parse(dir, ['big.ts']);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.symbolName === 'big' && chunk.symbolKind === 'FUNCTION')).toBe(
      true,
    );

    const sorted = [...chunks].sort((a, b) => a.partIndex - b.partIndex);
    expect(sorted.map((chunk) => chunk.partIndex)).toEqual(
      Array.from({ length: sorted.length }, (_, index) => index + 1),
    );
    expect(sorted.every((chunk) => chunk.partsTotal === sorted.length)).toBe(true);

    const reassembled = sorted.map((chunk) => chunk.content).join('\n');
    for (const index of [0, 39]) {
      expect(reassembled).toContain(`const line${index} = ${index};`);
    }
    // sin solapamiento: cada statement aparece exactamente una vez entre todas las partes
    expect(sorted.filter((chunk) => chunk.content.includes('const line0 = 0;'))).toHaveLength(1);
  });
});
