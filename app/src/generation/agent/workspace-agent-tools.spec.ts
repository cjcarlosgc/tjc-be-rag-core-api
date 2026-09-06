import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
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
    await writeFile(join(dir, 'src/helper.ts'), 'export function help(): string {\n  return "ok";\n}\n');
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

    const result = await tools.dispatch('list_files', {});

    expect(result).toContain('src/calculator.ts');
    expect(result).toContain('src/helper.ts');
    expect(result).not.toContain('src/calculator.spec.ts');
  });

  it('read_file returns the content of an allowed file', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('read_file', { relativePath: 'src/helper.ts' });

    expect(result).toContain('function help()');
  });

  it('read_file refuses an excluded test file', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('read_file', { relativePath: 'src/calculator.spec.ts' });

    expect(result).toContain('No se puede leer');
  });

  it('search_text finds matches with file and line number, only in allowed files', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('search_text', { query: 'return' });

    expect(result).toContain('src/calculator.ts:3:');
    expect(result).toContain('src/helper.ts:2:');
    expect(result).not.toContain('calculator.spec.ts');
  });

  it('inspect_symbol finds the declaration and does not report itself as an external reference', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('inspect_symbol', { symbolName: 'Calculator' });

    expect(result).toContain('Declarado en src/calculator.ts');
    expect(result).toContain('add(a: number, b: number)');
    expect(result).toContain('No se encontraron referencias en otros archivos.');
  });

  it('inspect_symbol reports a symbol unknown to the allowed files', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('inspect_symbol', { symbolName: 'DoesNotExist' });

    expect(result).toContain('No se encontró una declaración');
  });

  it('dispatch returns a message for an unknown tool name', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('delete_everything', {});

    expect(result).toContain('Herramienta desconocida');
  });
});
