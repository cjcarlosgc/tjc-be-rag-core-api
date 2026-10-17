import { describe, expect, it } from 'vitest';
import { isTestSourcePath } from './test-source-path.util.js';

describe('isTestSourcePath (WI-CORE-044, corte 4: sensible a projectRoot)', () => {
  describe('PHP', () => {
    it.each([
      'tests/Unit/FooTest.php',
      'tests/TestCase.php',
      'tests/Unit/Helper.php',
      'tests\\Unit\\Pricing\\PremiumTest.php',
      'app/Services/FooTest.php',
      'src/tests/Feature/BarTest.php',
    ])('marks %s as a test file under the repo root', (path) => {
      expect(isTestSourcePath(path, 'php')).toBe(true);
    });

    it.each([
      'app/Tests/Foo.php',
      'src/tests/Foo.php',
      'app/Modules/Tests/Foo.php',
      'app/Services/TestimonialService.php',
      'app/Services/Contest.php',
      'app/Services/TestsRunner.php',
      'app/Pricing/PremiumDiscountPolicy.php',
    ])('does not mark production file %s as a test file', (path) => {
      expect(isTestSourcePath(path, 'php')).toBe(false);
    });

    it.each([
      'backend/tests/Unit/FooTest.php',
      'backend/tests/Unit/Helper.php',
      'backend/tests/TestCase.php',
    ])('marks %s as a test file under projectRoot "backend"', (path) => {
      expect(isTestSourcePath(path, 'php', 'backend')).toBe(true);
    });

    it.each([
      'backend/app/Tests/X.php',
      'backend/src/tests/Foo.php',
      'backend/app/Services/TestimonialService.php',
    ])('does not mark production file %s under projectRoot "backend"', (path) => {
      expect(isTestSourcePath(path, 'php', 'backend')).toBe(false);
    });

    it('does not match a tests/ directory outside projectRoot by directory name', () => {
      expect(isTestSourcePath('tests/Unit/Helper.php', 'php', 'backend')).toBe(false);
    });

    it('still matches the *Test.php suffix outside projectRoot', () => {
      expect(isTestSourcePath('tests/Unit/FooTest.php', 'php', 'backend')).toBe(true);
    });
  });

  describe('TypeScript / JavaScript', () => {
    it.each([
      'src/foo.spec.ts',
      'src/foo.spec.tsx',
      'src/foo.spec.js',
      'src/foo.test.ts',
      'src/foo.test.tsx',
      'src/foo.test.js',
      'src/__tests__/foo.ts',
      'src\\__tests__\\foo.ts',
      'SRC/Foo.SPEC.TS',
      'tests/helpers.ts',
      'test/setup.ts',
    ])('marks %s as a test file under the repo root', (path) => {
      expect(isTestSourcePath(path, 'typescript')).toBe(true);
    });

    it.each([
      'src/tests/helper.ts',
      'src/test/helper.ts',
      'src/latest/contest.ts',
      'src/contest.ts',
      'src/testimonial.service.ts',
      'src/foo.ts',
    ])('does not mark production file %s as a test file', (path) => {
      expect(isTestSourcePath(path, 'typescript')).toBe(false);
    });

    it('marks files under tests/ and test/ of projectRoot "backend"', () => {
      expect(isTestSourcePath('backend/tests/helpers.ts', 'typescript', 'backend')).toBe(true);
      expect(isTestSourcePath('backend/test/setup.ts', 'typescript', 'backend')).toBe(true);
    });

    it('does not match tests/ outside projectRoot by directory name', () => {
      expect(isTestSourcePath('tests/helpers.ts', 'typescript', 'backend')).toBe(false);
    });

    it('keeps __tests__ and spec suffix rules under projectRoot', () => {
      expect(isTestSourcePath('backend/src/__tests__/foo.ts', 'typescript', 'backend')).toBe(true);
      expect(isTestSourcePath('backend/src/foo.spec.ts', 'typescript', 'backend')).toBe(true);
      expect(isTestSourcePath('backend/src/src/tests/helper.ts', 'typescript', 'backend')).toBe(false);
    });
  });

  describe('projectRoot normalization', () => {
    it.each(['./backend', 'backend/', './backend/'])(
      'treats projectRoot "%s" as "backend"',
      (root) => {
        expect(isTestSourcePath('backend/tests/Unit/Helper.php', 'php', root)).toBe(true);
        expect(isTestSourcePath('backend/app/Tests/X.php', 'php', root)).toBe(false);
      },
    );

    it.each(['.', ''])('treats projectRoot "%s" as the repo root', (root) => {
      expect(isTestSourcePath('tests/Unit/Helper.php', 'php', root)).toBe(true);
      expect(isTestSourcePath('app/Tests/X.php', 'php', root)).toBe(false);
    });
  });

  it('applies both rule sets when the language is not given', () => {
    expect(isTestSourcePath('tests/Unit/FooTest.php')).toBe(true);
    expect(isTestSourcePath('src/foo.spec.ts')).toBe(true);
    expect(isTestSourcePath('app/Services/TestimonialService.php')).toBe(false);
    expect(isTestSourcePath('app/Tests/Foo.php')).toBe(false);
    expect(isTestSourcePath('src/latest/contest.ts')).toBe(false);
  });
});
