import { describe, expect, it } from 'vitest';
import { phpTestLocation } from './php-test-path.js';

const noneExists = () => false;

describe('phpTestLocation', () => {
  it('places a method test under tests/Unit mirroring app/ with the namespace', () => {
    const location = phpTestLocation(
      {
        filePath: 'app/Pricing/PremiumDiscountPolicy.php',
        symbolName: 'App\\Pricing\\PremiumDiscountPolicy',
        methodName: 'discountFor',
        targetType: 'METHOD',
      },
      noneExists,
    );

    expect(location).toEqual({
      relativePath: 'tests/Unit/Pricing/PremiumDiscountPolicyDiscountForTest.php',
      namespace: 'Tests\\Unit\\Pricing',
    });
  });

  it('handles a model under app/Models', () => {
    const location = phpTestLocation(
      {
        filePath: 'app/Models/Subscription.php',
        symbolName: 'App\\Models\\Subscription',
        methodName: 'nextChargeAmount',
        targetType: 'METHOD',
      },
      noneExists,
    );

    expect(location).toEqual({
      relativePath: 'tests/Unit/Models/SubscriptionNextChargeAmountTest.php',
      namespace: 'Tests\\Unit\\Models',
    });
  });

  it('uses the namespace Tests\\Unit when the file sits directly under app/', () => {
    const location = phpTestLocation(
      {
        filePath: 'app/Helpers.php',
        symbolName: 'Helpers',
        methodName: 'format',
        targetType: 'METHOD',
      },
      noneExists,
    );

    expect(location).toEqual({
      relativePath: 'tests/Unit/HelpersFormatTest.php',
      namespace: 'Tests\\Unit',
    });
  });

  it('names FUNCTION targets after the function in the equivalent directory', () => {
    const location = phpTestLocation(
      {
        filePath: 'app/Support/money_format.php',
        symbolName: 'money_format',
        methodName: null,
        targetType: 'FUNCTION',
      },
      noneExists,
    );

    expect(location).toEqual({
      relativePath: 'tests/Unit/Support/MoneyFormatTest.php',
      namespace: 'Tests\\Unit\\Support',
    });
  });

  it('keeps the full relative path and capitalizes namespace segments for files outside app/', () => {
    const location = phpTestLocation(
      {
        filePath: 'src/Foo/Bar.php',
        symbolName: 'Bar',
        methodName: 'metodo',
        targetType: 'METHOD',
      },
      noneExists,
    );

    expect(location).toEqual({
      relativePath: 'tests/Unit/src/Foo/BarMetodoTest.php',
      namespace: 'Tests\\Unit\\Src\\Foo',
    });
  });

  it('uses the GeneratedTest suffix when the regular path already exists in the snapshot', () => {
    const existing = new Set(['tests/Unit/Pricing/PremiumDiscountPolicyDiscountForTest.php']);
    const location = phpTestLocation(
      {
        filePath: 'app/Pricing/PremiumDiscountPolicy.php',
        symbolName: 'App\\Pricing\\PremiumDiscountPolicy',
        methodName: 'discountFor',
        targetType: 'METHOD',
      },
      (path) => existing.has(path),
    );

    expect(location).toEqual({
      relativePath: 'tests/Unit/Pricing/PremiumDiscountPolicyDiscountForGeneratedTest.php',
      namespace: 'Tests\\Unit\\Pricing',
    });
  });
});
