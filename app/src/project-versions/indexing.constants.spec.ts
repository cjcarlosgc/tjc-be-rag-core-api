import { describe, expect, it } from 'vitest';
import {
  isPhpPoolFile,
  isPhpSourceFile,
  isTestFile,
  isTypeScriptPoolFile,
} from './indexing.constants.js';

describe('PHP and TypeScript indexing pools', () => {
  it('recognizes PHP sources and PHPUnit tests but excludes Blade templates', () => {
    expect(isPhpSourceFile('app/Services/Invoice.php')).toBe(true);
    expect(isPhpSourceFile('resources/views/invoice.blade.php')).toBe(false);
    expect(isTestFile('tests/Feature/InvoiceTest.php')).toBe(true);
    expect(isPhpPoolFile('composer.json')).toBe(true);
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
  });
});
