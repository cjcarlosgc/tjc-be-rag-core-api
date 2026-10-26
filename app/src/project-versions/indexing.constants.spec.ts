import { describe, expect, it } from 'vitest';
import {
  isPhpPoolFile,
  isPoolFile,
  isPhpSourceFile,
  isSandboxFixtureFile,
  isSandboxSnapshotFile,
  SANDBOX_FIXTURE_EXTENSIONS,
  SANDBOX_FIXTURE_LIMITS,
  SANDBOX_FIXTURE_SENSITIVE_NAME,
  isComposerManifest,
  isTestFile,
  isTypeScriptPoolFile,
} from './indexing.constants.js';

describe('PHP and TypeScript indexing pools', () => {
  it('recognizes PHP sources and PHPUnit tests but excludes Blade templates', () => {
    expect(isPhpSourceFile('app/Services/Invoice.php')).toBe(true);
    expect(isPhpSourceFile('resources/views/invoice.blade.php')).toBe(false);
    expect(isTestFile('tests/Feature/InvoiceTest.php')).toBe(true);
    expect(isPhpPoolFile('composer.json')).toBe(true);
    expect(isPhpPoolFile('COMPOSER.JSON')).toBe(false);
    expect(isComposerManifest('backend/composer.json')).toBe(true);
    expect(isComposerManifest('backend/COMPOSER.JSON')).toBe(false);
    expect(isPhpPoolFile('vendor/acme/Package.php')).toBe(false);
  });

  it('keeps PHP dependencies/runtime and generated frontend assets out of discovery', () => {
    expect(isPhpPoolFile('storage/framework/cache.php')).toBe(false);
    expect(isPhpPoolFile('bootstrap/cache/services.php')).toBe(false);
    expect(isPhpPoolFile('public/build/manifest.php')).toBe(false);
  });

  it('keeps PHP manifests and source out of the TypeScript-only snapshot pool', () => {
    expect(isTypeScriptPoolFile('package.json')).toBe(true);
    expect(isTypeScriptPoolFile('pnpm-lock.yaml')).toBe(true);
    expect(isTypeScriptPoolFile('composer.json')).toBe(false);
    expect(isTypeScriptPoolFile('src/Service.php')).toBe(false);
    expect(isTypeScriptPoolFile('src/index.ts')).toBe(true);
  });
});

describe('Sandbox snapshot fixtures (WI-CORE-102)', () => {
  it('declares the approved limits and the closed extension set', () => {
    expect(SANDBOX_FIXTURE_LIMITS).toEqual({
      maxFiles: 500,
      maxFileBytes: 1_048_576,
      maxTotalBytes: 5_242_880,
      maxCompressionRatio: 80,
    });
    expect([...SANDBOX_FIXTURE_EXTENSIONS].sort()).toEqual(
      ['conf', 'csv', 'dist', 'ini', 'json', 'neon', 'sql', 'tsv', 'txt', 'xml', 'yaml', 'yml'],
    );
  });

  it.each([
    'examples/rbac_model.conf',
    'examples/rbac_policy.csv',
    'tests/fixtures/data.json',
    'tests/Unit/test.ini',
    'tests/data.TSV',
    'config/settings.yml',
    'config/settings.yaml',
    'resources/schema.xml',
    'notes.txt',
    'phpstan.neon',
    'database/seed.sql',
    'infection.json.dist',
    'a/b/c/d/deep.conf',
    'oauth2.json',
    'authors.json',
    'config/author_list.csv',
  ])('includes %s as a fixture', (path) => {
    expect(isSandboxFixtureFile(path)).toBe(true);
    expect(isSandboxSnapshotFile(path)).toBe(true);
  });

  it.each([
    '.env',
    '.env.testing',
    'config/.env.example',
    '.github/workflows/ci.yml',
    '.idea/workspace.xml',
    'tests/.hidden/data.json',
    'vendor/x/y.json',
    'build/a.json',
    'node_modules/pkg/data.json',
    'storage/app/data.json',
    'cache/data.json',
    'package-lock.json',
    'sub/Package-Lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'image.png',
    'archive.zip',
    'README.md',
    'LICENSE',
    'Makefile',
    'src/Foo.php',
    'composer.json',
    'composer.lock',
    'phpunit.xml',
    'phpunit.xml.dist',
    'package.json',
    'tests/package.json',
    'tsconfig.json',
    'jest.config.json',
    'vitest.config.json',
    'sub/tsconfig.json',
    'auth.json',
    'sub/auth.json',
    'credentials.json',
    'credential.json',
    'config/secrets.yml',
    'service-account.json',
    'service_account.json',
    'serviceaccount.json',
    'my_secret.json',
    'app.secrets.yaml',
    'Credentials.JSON',
  ])('does not treat %s as an extra fixture', (path) => {
    expect(isSandboxFixtureFile(path)).toBe(false);
  });

  it('exports the sensitive-name pattern with the agreed semantics', () => {
    expect(SANDBOX_FIXTURE_SENSITIVE_NAME.test('auth.json')).toBe(true);
    expect(SANDBOX_FIXTURE_SENSITIVE_NAME.test('oauth2.json')).toBe(false);
    expect(SANDBOX_FIXTURE_SENSITIVE_NAME.test('authors.json')).toBe(false);
    expect(SANDBOX_FIXTURE_SENSITIVE_NAME.test('rbac_model.conf')).toBe(false);
  });

  it('never treats a pool file as a fixture and does not ship Node config files in the PHP snapshot', () => {
    for (const path of ['package.json', 'tests/package.json', 'tsconfig.json', 'jest.config.json', 'vitest.config.json']) {
      expect(isPoolFile(path)).toBe(true);
      expect(isSandboxFixtureFile(path)).toBe(false);
      expect(isSandboxSnapshotFile(path)).toBe(false);
    }
    expect(isSandboxFixtureFile('tests/fixtures/data.json')).toBe(true);
  });

  it('keeps PHP pool files in the Sandbox snapshot without duplicating them as fixtures', () => {
    for (const path of ['src/Foo.php', 'composer.json', 'composer.lock', 'phpunit.xml', 'phpunit.xml.dist']) {
      expect(isSandboxFixtureFile(path)).toBe(false);
      expect(isSandboxSnapshotFile(path)).toBe(true);
    }
    expect(isSandboxSnapshotFile('vendor/x/Foo.php')).toBe(false);
    expect(isSandboxSnapshotFile('.env')).toBe(false);
    expect(isSandboxSnapshotFile('README.md')).toBe(false);
  });

  it('does not change the PHP and indexing pools: fixtures never enter them', () => {
    for (const path of ['examples/rbac_model.conf', 'tests/fixtures/data.json', 'notes.txt', 'config/a.yml']) {
      expect(isPhpPoolFile(path)).toBe(false);
      expect(isPoolFile(path)).toBe(false);
      expect(isTypeScriptPoolFile(path)).toBe(false);
    }
    expect(isPhpPoolFile('src/Foo.php')).toBe(true);
    expect(isPhpPoolFile('phpunit.xml.dist')).toBe(true);
    expect(isPoolFile('src/Foo.php')).toBe(true);
    expect(isPoolFile('src/index.ts')).toBe(true);
    expect(isPoolFile('package.json')).toBe(true);
    expect(isPoolFile('tests/Foo.php')).toBe(true);
    expect(isPoolFile('vendor/x/Foo.php')).toBe(false);
    expect(isTypeScriptPoolFile('pnpm-lock.yaml')).toBe(true);
  });
});
