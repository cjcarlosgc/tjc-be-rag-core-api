import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceAgentTools } from './workspace-agent-tools.js';

describe('WorkspaceAgentTools', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-tools-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src/calculator.ts'),
      [
        'export class Calculator {',
        '  add(a: number, b: number): number {',
        '    return a + b;',
        '  }',
        '}',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'src/calculator.spec.ts'),
      "import { Calculator } from './calculator.js';\ntest('adds', () => {});",
    );
    await writeFile(
      join(dir, 'src/helper.ts'),
      'export function help(): string {\n  return "ok";\n}\n',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeTools(excluded: string[] = ['src/calculator.spec.ts']) {
    return new WorkspaceAgentTools(
      dir,
      ['src/calculator.ts', 'src/calculator.spec.ts', 'src/helper.ts'],
      excluded,
    );
  }

  it('list_files excludes the test files covering the current target', async () => {
    const tools = makeTools();

    const result = await tools.dispatchWithObservations('list_files', {});

    expect(result.result).toBe('src/calculator.ts\nsrc/helper.ts');
    expect(result.discoveredFiles).toEqual([
      'src/calculator.ts',
      'src/helper.ts',
    ]);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.observations).toEqual([
      {
        kind: 'FILE_LIST_SUMMARY',
        filePath: null,
        symbolName: null,
        excerpt: null,
        discoveredFilesCount: 2,
      },
    ]);
    expect(JSON.stringify(result.observations)).not.toContain(
      'src/calculator.ts',
    );
  });

  it('read_file returns the content of an allowed file', async () => {
    const tools = makeTools();

    const result = await tools.dispatchWithObservations('read_file', {
      relativePath: 'src/helper.ts',
    });

    expect(result.result).toBe(
      'export function help(): string {\n  return "ok";\n}\n',
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.observations[0]).toMatchObject({
      kind: 'FILE_CONTENT',
      filePath: 'src/helper.ts',
      excerpt: {
        filePath: 'src/helper.ts',
        startLine: 1,
        endLine: 4,
        snippet: result.result,
        truncated: false,
        contentSha256: createHash('sha256')
          .update(result.result, 'utf8')
          .digest('hex'),
      },
    });
  });

  it('read_file refuses an excluded test file', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('read_file', {
      relativePath: 'src/calculator.spec.ts',
    });

    expect(result).toContain('No se puede leer');
  });

  it('returns an exact model string while bounding and hashing a long file observation', async () => {
    const longContent = 'x'.repeat(20_001);
    await writeFile(join(dir, 'src/long.ts'), longContent);
    const tools = new WorkspaceAgentTools(dir, ['src/long.ts'], []);

    const result = await tools.dispatchWithObservations('read_file', {
      relativePath: 'src/long.ts',
    });

    expect(result.result).toBe(`${'x'.repeat(20_000)}\n... (truncado)`);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.observations[0].excerpt?.snippet).toBe('x'.repeat(2_000));
    expect(result.observations[0].excerpt?.truncated).toBe(true);
    expect(result.observations[0].excerpt?.contentSha256).toBe(
      createHash('sha256').update('x'.repeat(2_000), 'utf8').digest('hex'),
    );
  });

  it('search_text finds matches with file and line number, only in allowed files', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('search_text', { query: 'return' });

    expect(result).toContain('src/calculator.ts:3:');
    expect(result).toContain('src/helper.ts:2:');
    expect(result).not.toContain('calculator.spec.ts');
  });

  it('normalizes search matches in the same deterministic order as the model result', async () => {
    const tools = makeTools();

    const result = await tools.dispatchWithObservations('search_text', {
      query: 'return',
    });

    expect(result.result).toBe(
      'src/calculator.ts:3: return a + b;\nsrc/helper.ts:2: return "ok";',
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(
      result.observations.map(({ kind, filePath, excerpt }) => [
        kind,
        filePath,
        excerpt?.startLine,
        excerpt?.endLine,
        excerpt?.snippet,
      ]),
    ).toEqual([
      ['TEXT_MATCH', 'src/calculator.ts', 3, 3, 'return a + b;'],
      ['TEXT_MATCH', 'src/helper.ts', 2, 2, 'return "ok";'],
    ]);
  });

  it('marks no matches EMPTY and invalid arguments FAILED', async () => {
    const tools = makeTools();

    const empty = await tools.dispatchWithObservations('search_text', {
      query: 'absent',
    });
    const failed = await tools.dispatchWithObservations('search_text', {
      query: '',
    });

    expect(empty).toMatchObject({
      result: 'Sin coincidencias para "absent".',
      status: 'EMPTY',
      observations: [],
    });
    expect(failed).toMatchObject({
      result: 'Se requiere "query".',
      status: 'FAILED',
      observations: [],
    });
  });

  it('inspect_symbol finds the declaration and does not report itself as an external reference', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('inspect_symbol', {
      symbolName: 'Calculator',
    });

    expect(result).toContain('Declarado en src/calculator.ts');
    expect(result).toContain('add(a: number, b: number)');
    expect(result).toContain(
      'No se encontraron referencias en otros archivos.',
    );
  });

  it('returns symbol evidence separately while preserving the existing model response', async () => {
    const tools = makeTools();

    const result = await tools.dispatchWithObservations('inspect_symbol', {
      symbolName: 'Calculator',
    });

    expect(result.result).toBe(
      'Declarado en src/calculator.ts:\nexport class Calculator {\n  add(a: number, b: number): number {\n    return a + b;\n  }\n}\n\nNo se encontraron referencias en otros archivos.',
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.observations[0]).toMatchObject({
      kind: 'SYMBOL',
      filePath: 'src/calculator.ts',
      symbolName: 'Calculator',
      excerpt: {
        symbolName: 'Calculator',
        startLine: 1,
        endLine: 5,
        snippet:
          'export class Calculator {\n  add(a: number, b: number): number {\n    return a + b;\n  }\n}',
      },
    });
  });

  it('inspect_symbol reports a symbol unknown to the allowed files', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('inspect_symbol', {
      symbolName: 'DoesNotExist',
    });

    expect(result).toContain('No se encontró una declaración');
  });

  it('dispatch returns a message for an unknown tool name', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('delete_everything', {});

    expect(result).toContain('Herramienta desconocida');
  });

  it('classifies an unknown tool dispatch as FAILED', async () => {
    const tools = makeTools();

    await expect(
      tools.dispatchWithObservations('delete_everything', {}),
    ).resolves.toMatchObject({
      status: 'FAILED',
      observations: [],
    });
  });
});
