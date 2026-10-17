import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestTargetType } from '../../generated/prisma/enums.js';
import { PhpExistingTestResolverService } from './php-existing-test-resolver.service.js';

describe('PhpExistingTestResolverService', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'php-test-resolver-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('matches a public method through a PHPUnit import alias and invocation', async () => {
    await writeFile(join(dir, 'ServiceTest.php'), [
      '<?php',
      'namespace Tests\\Unit;',
      'use App\\Services\\{Service as Subject};',
      'class ServiceTest {',
      '  public function testRun(): void { (new Subject())->run(); }',
      '}',
    ].join('\n'));

    const result = await new PhpExistingTestResolverService().resolve(dir, ['ServiceTest.php'], [
      { filePath: 'src/Service.php', symbolName: 'App\\Services\\Service', methodName: 'run', targetType: TestTargetType.METHOD, startLine: 4, endLine: 4 },
      { filePath: 'src/Service.php', symbolName: 'App\\Services\\Service', methodName: 'save', targetType: TestTargetType.METHOD, startLine: 5, endLine: 5 },
    ]);

    expect(result[0]).toMatchObject({ hasTest: true, testFilePaths: ['ServiceTest.php'] });
    expect(result[1]).toMatchObject({ hasTest: false, testFilePaths: [] });
  });
});
