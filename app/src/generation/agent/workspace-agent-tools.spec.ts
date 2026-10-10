import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_TOOL_SCHEMAS,
  WorkspaceAgentTools,
} from './workspace-agent-tools.js';

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

  function makeTools() {
    return new WorkspaceAgentTools(dir, [
      'src/calculator.ts',
      'src/calculator.spec.ts',
      'src/helper.ts',
    ]);
  }

  it('list_files lists existing test files as discoverable snapshot files', async () => {
    const tools = makeTools();

    const result = await tools.dispatchWithObservations('list_files', {});

    expect(result.result).toBe(
      'src/calculator.spec.ts\nsrc/calculator.ts\nsrc/helper.ts',
    );
    expect(result.discoveredFiles).toEqual([
      'src/calculator.spec.ts',
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
        discoveredFilesCount: 3,
      },
    ]);
  });

  it('does not expose files outside the snapshot pool such as node_modules or .git', async () => {
    const tools = new WorkspaceAgentTools(dir, ['src/helper.ts']);

    const list = await tools.dispatch('list_files', {});
    const read = await tools.dispatch('read_file', {
      relativePath: 'node_modules/pkg/index.ts',
    });
    const gitRead = await tools.dispatch('read_file', {
      relativePath: '.git/config',
    });
    const search = await tools.dispatch('search_text', { query: 'pkg' });

    expect(list).toBe('src/helper.ts');
    expect(read).toContain('No se puede leer');
    expect(gitRead).toContain('No se puede leer');
    expect(search).toBe('Sin coincidencias para "pkg".');
  });

  it('exposes exactly the four read-only tools', () => {
    expect(AGENT_TOOL_SCHEMAS.map((schema) => schema.function.name)).toEqual([
      'list_files',
      'read_file',
      'search_text',
      'inspect_symbol',
    ]);
  });

  it('describes tools without any test-exclusion wording', () => {
    const descriptions = AGENT_TOOL_SCHEMAS.map(
      (schema) => schema.function.description,
    ).join('\n');

    expect(descriptions).not.toMatch(/test|prueba/i);
    expect(descriptions).not.toMatch(/excluid|cubren el target/i);
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

  it('read_file returns the content of an existing test file', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('read_file', {
      relativePath: 'src/calculator.spec.ts',
    });

    expect(result).toContain("test('adds'");
  });

  it('returns an exact model string while bounding and hashing a long file observation', async () => {
    const longContent = 'x'.repeat(20_001);
    await writeFile(join(dir, 'src/long.ts'), longContent);
    const tools = new WorkspaceAgentTools(dir, ['src/long.ts']);

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

  it('search_text finds matches with file and line number, including existing tests', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('search_text', { query: 'return' });

    expect(result).toContain('src/calculator.ts:3:');
    expect(result).toContain('src/helper.ts:2:');
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

  it('inspect_symbol finds the declaration and lists the existing test as a reference', async () => {
    const tools = makeTools();

    const result = await tools.dispatch('inspect_symbol', {
      symbolName: 'Calculator',
    });

    expect(result).toContain('Declarado en src/calculator.ts');
    expect(result).toContain('add(a: number, b: number)');
    expect(result).toContain('Referenciado también en: src/calculator.spec.ts');
  });

  it('returns symbol evidence separately while preserving the existing model response', async () => {
    const tools = makeTools();

    const result = await tools.dispatchWithObservations('inspect_symbol', {
      symbolName: 'Calculator',
    });

    expect(result.result).toBe(
      'Declarado en src/calculator.ts:\nexport class Calculator {\n  add(a: number, b: number): number {\n    return a + b;\n  }\n}\n\nReferenciado también en: src/calculator.spec.ts',
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

  describe('inspect_symbol con archivos PHP', () => {
    beforeEach(async () => {
      await mkdir(join(dir, 'app/Models'), { recursive: true });
      await writeFile(
        join(dir, 'app/Models/Invoice.php'),
        [
          '<?php',
          'namespace App\\Models;',
          '',
          'class Invoice {',
          '    public function total(): int {',
          '        return 1;',
          '    }',
          '}',
        ].join('\n'),
      );
      await writeFile(
        join(dir, 'app/Services.php'),
        [
          '<?php',
          'namespace App;',
          '',
          'use App\\Models\\Invoice;',
          '',
          'function billing(): void {',
          '    $invoice = new Invoice();',
          '}',
        ].join('\n'),
      );
    });

    function makePhpTools() {
      return new WorkspaceAgentTools(dir, [
        'app/Models/Invoice.php',
        'app/Services.php',
      ]);
    }

    it('finds a namespaced class with its 1-based lines and references in other PHP files', async () => {
      const tools = makePhpTools();

      const result = await tools.dispatchWithObservations('inspect_symbol', {
        symbolName: 'Invoice',
      });

      expect(result.result).toBe(
        'Declarado en app/Models/Invoice.php:\nclass Invoice {\n    public function total(): int {\n        return 1;\n    }\n}\n\nReferenciado también en: app/Services.php',
      );
      expect(result.status).toBe('SUCCEEDED');
      expect(result.observations[0]).toMatchObject({
        kind: 'SYMBOL',
        filePath: 'app/Models/Invoice.php',
        symbolName: 'Invoice',
        excerpt: {
          symbolName: 'Invoice',
          startLine: 4,
          endLine: 8,
        },
      });
    });

    it('finds interfaces, traits, enums and top-level functions', async () => {
      await writeFile(
        join(dir, 'app/Kinds.php'),
        [
          '<?php',
          'namespace App;',
          '',
          'interface Shape {',
          '    public function area(): float;',
          '}',
          '',
          'trait Loggable {',
          '    public function log(): void {}',
          '}',
          '',
          'enum Status: string {',
          "    case Open = 'open';",
          '}',
          '',
          'function helper_fn(): int {',
          '    return 1;',
          '}',
        ].join('\n'),
      );
      const tools = new WorkspaceAgentTools(dir, ['app/Kinds.php']);

      const expected: Array<[string, number, number]> = [
        ['Shape', 4, 6],
        ['Loggable', 8, 10],
        ['Status', 12, 14],
        ['helper_fn', 16, 18],
      ];
      for (const [symbolName, startLine, endLine] of expected) {
        const result = await tools.dispatchWithObservations('inspect_symbol', {
          symbolName,
        });

        expect(result.status).toBe('SUCCEEDED');
        expect(result.observations[0]?.excerpt).toMatchObject({
          startLine,
          endLine,
        });
      }
    });

    it('marks an unknown PHP symbol as EMPTY', async () => {
      const tools = makePhpTools();

      const result = await tools.dispatchWithObservations('inspect_symbol', {
        symbolName: 'MissingPhpClass',
      });

      expect(result).toMatchObject({
        status: 'EMPTY',
        observations: [],
      });
      expect(result.result).toContain('No se encontró una declaración');
    });

    it('does not break when a PHP file has a syntax error', async () => {
      await writeFile(
        join(dir, 'app/Broken.php'),
        '<?php\nclass Broken {\n    public function (( {\n',
      );
      const tools = new WorkspaceAgentTools(dir, [
        'app/Broken.php',
        'app/Models/Invoice.php',
      ]);

      const result = await tools.dispatchWithObservations('inspect_symbol', {
        symbolName: 'Invoice',
      });
      const broken = await tools.dispatchWithObservations('inspect_symbol', {
        symbolName: 'Broken',
      });

      expect(result.status).toBe('SUCCEEDED');
      expect(result.observations[0]?.filePath).toBe('app/Models/Invoice.php');
      expect(broken.status).toBe('EMPTY');
    });

    it('prefers the first declaration in sorted pool order when TypeScript and PHP both declare it', async () => {
      await mkdir(join(dir, 'a'), { recursive: true });
      await writeFile(join(dir, 'a/Dup.ts'), 'export class Invoice {}\n');
      const tools = new WorkspaceAgentTools(dir, [
        'app/Models/Invoice.php',
        'a/Dup.ts',
      ]);

      const result = await tools.dispatchWithObservations('inspect_symbol', {
        symbolName: 'Invoice',
      });

      expect(result.result).toContain('Declarado en a/Dup.ts:');
    });
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
