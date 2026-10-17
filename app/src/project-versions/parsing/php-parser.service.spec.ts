import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhpParserService } from './php-parser.service.js';

function makeConfigService(maxChunkTokens = 1500) {
  return { get: () => maxChunkTokens } as never;
}

describe('PhpParserService', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'php-parser-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts namespaced symbols, imports, traits and only public test targets', async () => {
    await writeFile(join(dir, 'Service.php'), [
      '<?php',
      'namespace App\\Services;',
      'use App\\Contracts\\Repository;',
      'class Service {',
      '  public function run(Repository $repository): void {}',
      '  private function internal(): void {}',
      '  protected function hidden(): void {}',
      '  public function __construct() {}',
      '}',
      'trait Logs {}',
      'interface ServiceContract {}',
      'enum Status: string { case READY = "ready"; }',
      'function helper(): void {}',
    ].join('\n'));

    const result = await new PhpParserService(makeConfigService()).analyze(dir, ['Service.php']);

    expect(result.chunks.map((chunk) => chunk.symbolKind)).toEqual([
      'CLASS', 'METHOD', 'METHOD', 'METHOD', 'CONSTRUCTOR', 'TRAIT', 'INTERFACE', 'ENUM', 'FUNCTION',
    ]);
    expect(result.chunks[0]).toMatchObject({ symbolName: 'App\\Services\\Service', parentSymbolName: null });
    expect(result.chunks[1]).toMatchObject({ symbolName: 'run', parentSymbolName: 'App\\Services\\Service' });
    expect(result.chunks[1].importsUsed).toEqual(['App\\Contracts\\Repository']);
    expect(result.candidates.map(({ symbolName, methodName, targetType }) => ({ symbolName, methodName, targetType }))).toEqual([
      { symbolName: 'App\\Services\\Service', methodName: null, targetType: 'CLASS' },
      { symbolName: 'App\\Services\\Service', methodName: 'run', targetType: 'METHOD' },
      { symbolName: 'App\\Services\\helper', methodName: null, targetType: 'FUNCTION' },
    ]);
  });

  it('supports bracketed namespace blocks and recovers declarations after syntax errors', async () => {
    await writeFile(join(dir, 'Recovery.php'), [
      '<?php',
      'namespace App\\Broken {',
      'class Before { public function ok(): void {} }',
      '$broken = ;',
      'class After { public function works(): void {} }',
      '}',
    ].join('\n'));

    const result = await new PhpParserService(makeConfigService()).analyze(dir, ['Recovery.php']);

    expect(result.chunks.some((chunk) => chunk.symbolName === 'App\\Broken\\Before')).toBe(true);
    expect(result.chunks.some((chunk) => chunk.symbolName === 'App\\Broken\\After')).toBe(true);
  });

  it('splits oversized declarations into ordered non-overlapping parts', async () => {
    await writeFile(join(dir, 'Large.php'), [
      '<?php',
      'namespace App;',
      'class Large {',
      '  public function first() { return "alpha beta gamma delta epsilon"; }',
      '  public function second() { return "zeta eta theta iota kappa"; }',
      '}',
    ].join('\n'));

    const result = await new PhpParserService(makeConfigService(10)).analyze(dir, ['Large.php']);
    const classChunks = result.chunks.filter((chunk) => chunk.symbolKind === 'CLASS');

    expect(classChunks.length).toBeGreaterThan(1);
    expect(classChunks.map((chunk) => chunk.partIndex)).toEqual(classChunks.map((_, index) => index + 1));
    expect(classChunks.every((chunk) => chunk.partsTotal === classChunks.length)).toBe(true);
  });
});
