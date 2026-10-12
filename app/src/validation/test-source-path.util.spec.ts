import { describe, expect, it } from 'vitest';
import { isTestSourcePath } from './test-source-path.util.js';

describe('isTestSourcePath (WI-CORE-044, corte 2)', () => {
  describe('PHP', () => {
    it.each([
      'tests/Unit/FooTest.php',
      'Tests/Unit/FooTest.php',
      'src/tests/Feature/BarTest.php',
      'tests\\Unit\\Pricing\\PremiumTest.php',
      'app/Services/FooTest.php',
      'tests/Unit/Helper.php',
    ])('marks %s as a test file', (path) => {
      expect(isTestSourcePath(path, 'php')).toBe(true);
    });

    it.each([
      'app/Services/TestimonialService.php',
      'app/Services/Contest.php',
      'app/Services/TestsRunner.php',
      'app/Pricing/PremiumDiscountPolicy.php',
    ])('does not mark production file %s as a test file', (path) => {
      expect(isTestSourcePath(path, 'php')).toBe(false);
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
    ])('marks %s as a test file', (path) => {
      expect(isTestSourcePath(path, 'typescript')).toBe(true);
    });

    it.each([
      'src/latest/contest.ts',
      'src/contest.ts',
      'src/testimonial.service.ts',
      'src/tests/helper.ts',
      'src/foo.ts',
    ])('does not mark production file %s as a test file', (path) => {
      expect(isTestSourcePath(path, 'typescript')).toBe(false);
    });
  });

  it('applies both rule sets when the language is not given', () => {
    expect(isTestSourcePath('tests/Unit/FooTest.php')).toBe(true);
    expect(isTestSourcePath('src/foo.spec.ts')).toBe(true);
    expect(isTestSourcePath('app/Services/TestimonialService.php')).toBe(false);
    expect(isTestSourcePath('src/latest/contest.ts')).toBe(false);
  });
});
