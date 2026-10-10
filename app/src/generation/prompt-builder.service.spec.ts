import { describe, expect, it } from 'vitest';
import { PromptBuilder, sanitizeGeneratedPhp } from './prompt-builder.service.js';
import type { FunctionalRule, GenerationContext } from '../retrieval/generation-context.js';
import { renderFunctionalRule } from '../retrieval/functional-rule-format.js';

function makeContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    target: {
      filePath: 'src/foo.ts',
      symbolName: 'Foo',
      methodName: 'bar',
      targetType: 'METHOD',
      content: 'bar(): number { return 1; }',
    },
    relatedChunks: [],
    functionalRules: [],
    metadata: { language: 'typescript', framework: 'VITEST' },
    retrievedChunks: 0,
    selectedChunks: 0,
    contextTokens: 10,
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  it('includes the target label, file, code and framework', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(makeContext());

    expect(prompt).toContain('Foo.bar');
    expect(prompt).toContain('src/foo.ts');
    expect(prompt).toContain('bar(): number { return 1; }');
    expect(prompt).toContain('VITEST');
    expect(prompt).not.toContain('```\n\n```');
  });

  it('uses the function label for FUNCTION targets without a methodName', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(
      makeContext({
        target: {
          filePath: 'src/util.ts',
          symbolName: 'add',
          methodName: null,
          targetType: 'FUNCTION',
          content: 'function add() {}',
        },
      }),
    );

    expect(prompt).toContain('la función "add"');
  });

  it('includes related chunks labeled with their file and symbol', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(
      makeContext({
        relatedChunks: [
          {
            filePath: 'src/helper.ts',
            symbolKind: 'FUNCTION',
            symbolName: 'help',
            parentSymbolName: null,
            content: 'function help() {}',
            score: 0.9,
            matchedVia: ['SEMANTIC'],
          },
        ],
      }),
    );

    expect(prompt).toContain('src/helper.ts');
    expect(prompt).toContain('function help() {}');
  });

  it('falls back to a framework-agnostic instruction when framework is null', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(makeContext({ metadata: { language: 'typescript', framework: null } }));

    expect(prompt).toContain('Jest o Vitest');
  });

  it('presents functional rules in their own block after the code and before the related context', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(
      makeContext({
        relatedChunks: [
          {
            filePath: 'src/other.ts',
            symbolKind: 'FUNCTION',
            symbolName: 'other',
            parentSymbolName: null,
            content: 'function other() {}',
            score: 0.8,
            matchedVia: ['SEMANTIC'],
          },
        ],
        functionalRules: [
          {
            knowledgeId: 'rule-1',
            scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
            normalizedRule: 'Devuelve 1 siempre.',
            scope: 'METHOD',
            targetRef: 'src/foo.ts::Foo.bar',
            source: 'HUMAN_ANSWER',
            provenance: {
              confirmedByUserId: 'user-secret',
              confirmedRole: 'ADMIN',
              originHeadSha: 'head-sha',
              sourceRef: null,
            },
          },
        ],
      }),
    );

    const rulesIndex = prompt.indexOf('Reglas funcionales');
    expect(rulesIndex).toBeGreaterThan(prompt.indexOf('Código objetivo:'));
    expect(rulesIndex).toBeLessThan(prompt.indexOf('Contexto relacionado del mismo proyecto:'));
    expect(prompt).toContain('- [EXPECTED_RESULT:aaaaaaaaaaaaaaaa] Devuelve 1 siempre.');
    expect(prompt).toContain('confirmada por rol ADMIN');
    expect(prompt).not.toContain('user-secret');
  });

  it('omits the functional rules block when there are no rules', () => {
    const prompt = new PromptBuilder().build(makeContext());

    expect(prompt).not.toContain('Reglas funcionales');
  });
});

describe('PromptBuilder (PHP)', () => {
  function makePhpContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
    return makeContext({
      target: {
        filePath: 'app/Pricing/PremiumDiscountPolicy.php',
        symbolName: 'App\\Pricing\\PremiumDiscountPolicy',
        methodName: 'discountFor',
        targetType: 'METHOD',
        content: 'public function discountFor(int $n): int { return $n; }',
      },
      metadata: { language: 'php', framework: 'PHPUNIT' },
      ...overrides,
    });
  }

  it('asks for a complete PHPUnit 11 file starting with <?php and the given namespace', () => {
    const prompt = new PromptBuilder().build(makePhpContext(), {
      testNamespace: 'Tests\\Unit\\Pricing',
      testPath: 'tests/Unit/Pricing/PremiumDiscountPolicyDiscountForTest.php',
    });

    expect(prompt).toContain('<?php');
    expect(prompt).toContain('PHPUnit 11');
    expect(prompt).toContain('namespace Tests\\Unit\\Pricing');
    expect(prompt).toContain('tests/Unit/Pricing/PremiumDiscountPolicyDiscountForTest.php');
    expect(prompt).toContain('PHPUnit\\Framework\\TestCase');
    expect(prompt).toContain('Tests\\TestCase');
    expect(prompt).toContain('```php');
    expect(prompt).toContain('public function discountFor(int $n): int { return $n; }');
    expect(prompt).toContain('empezando por `<?php`');
    expect(prompt).toContain('No envuelvas la respuesta en fences de markdown');
    expect(prompt).not.toContain('Jest o Vitest');
    expect(prompt).not.toContain('```ts');
  });

  it('includes functional rules and related chunks as in TypeScript', () => {
    const rule: FunctionalRule = {
      knowledgeId: 'rule-1',
      scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
      normalizedRule: 'Devuelve 10% a clientes premium.',
      scope: 'SYMBOL',
      targetRef: 'app/Pricing/PremiumDiscountPolicy.php::discountFor',
      source: 'HUMAN_ANSWER',
      provenance: {
        confirmedByUserId: null,
        confirmedRole: null,
        originHeadSha: null,
        sourceRef: null,
      },
    };
    const prompt = new PromptBuilder().build(
      makePhpContext({
        functionalRules: [rule],
        relatedChunks: [
          {
            filePath: 'app/Models/Subscription.php',
            symbolKind: 'METHOD',
            symbolName: 'plan',
            parentSymbolName: 'Subscription',
            content: 'public function plan() {}',
            score: 0.8,
            matchedVia: ['SEMANTIC'],
          },
        ],
      }),
    );

    expect(prompt).toContain('Reglas funcionales');
    expect(prompt).toContain(renderFunctionalRule(rule));
    expect(prompt).toContain('--- app/Models/Subscription.php (METHOD Subscription.plan) ---');
  });

  it('keeps the TypeScript prompt free of PHP instructions when language is typescript', () => {
    const prompt = new PromptBuilder().build(makeContext(), {
      testNamespace: 'Tests\\Unit',
      testPath: 'tests/Unit/Foo.php',
    });

    expect(prompt).toContain('TypeScript');
    expect(prompt).not.toContain('<?php');
    expect(prompt).not.toContain('PHPUnit');
  });
});

describe('sanitizeGeneratedPhp', () => {
  it('returns the content unchanged when there are no fences', () => {
    expect(sanitizeGeneratedPhp('<?php\nclass A {}\n')).toBe('<?php\nclass A {}');
  });

  it('removes a ```php fence', () => {
    expect(sanitizeGeneratedPhp('```php\n<?php\nclass A {}\n```')).toBe('<?php\nclass A {}');
  });

  it('removes a bare ``` fence and surrounding whitespace', () => {
    expect(sanitizeGeneratedPhp('  \n```\n<?php\nclass B {}\n```\n  ')).toBe('<?php\nclass B {}');
  });

  it('returns null when the result does not start with <?php', () => {
    expect(sanitizeGeneratedPhp('Aquí tienes:\n```php\n<?php\n```')).toBeNull();
    expect(sanitizeGeneratedPhp('class A {}')).toBeNull();
    expect(sanitizeGeneratedPhp('```php\n```')).toBeNull();
  });
});
