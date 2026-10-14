import { describe, expect, it } from 'vitest';
import { PromptBuilder, sanitizeGeneratedPhp } from './prompt-builder.service.js';
import { PHP_PHPUNIT_CONVENTION_LINES, PHP_PROMPT_CONVENTIONS_VERSION } from './php-phpunit-conventions.js';
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

describe('PromptBuilder PHP dependency context (WI-CORE-057)', () => {
  const sectionText = [
    'Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`):',
    '- RenewalDatePolicy → Pilot\\Subscriptions\\Contracts\\RenewalDatePolicy (constructor)',
  ].join('\n');
  const rule: FunctionalRule = {
    knowledgeId: 'rule-1',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    normalizedRule: 'Regla de prueba PHP.',
    scope: 'METHOD',
    targetRef: 'src/Services/RenewalService.php::renew',
    source: 'HUMAN_ANSWER',
    provenance: { confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null },
  };
  const phpContext = (overrides: Partial<GenerationContext> = {}): GenerationContext =>
    makeContext({
      target: {
        filePath: 'src/Services/RenewalService.php',
        symbolName: 'RenewalService',
        methodName: 'renew',
        targetType: 'METHOD',
        content: 'public function renew(): void {}',
      },
      metadata: { language: 'php', framework: 'PHPUNIT' },
      relatedChunks: [
        {
          filePath: 'src/Other.php',
          symbolKind: 'CLASS',
          symbolName: 'Other',
          parentSymbolName: null,
          content: 'class Other {}',
          score: 0.9,
          matchedVia: ['SEMANTIC'],
        },
      ],
      functionalRules: [rule],
      ...overrides,
    });
  const dependencyContext = (text: string) => ({
    entries: [
      {
        typeName: 'RenewalDatePolicy',
        fqcn: 'Pilot\\Subscriptions\\Contracts\\RenewalDatePolicy',
        origin: 'CONSTRUCTOR' as const,
        resolvedBy: 'SAME_NAMESPACE' as const,
      },
    ],
    unresolvedCount: 0,
    tokenCount: 30,
    truncated: false,
    text,
  });

  it('inserts the section after the target code and before the functional rules and related context', () => {
    const prompt = new PromptBuilder().build(phpContext({ dependencyContext: dependencyContext(sectionText) }));

    expect(prompt).toContain(sectionText);
    const targetAt = prompt.indexOf('public function renew(): void {}');
    const sectionAt = prompt.indexOf(sectionText);
    const rulesAt = prompt.indexOf('Reglas funcionales');
    const relatedAt = prompt.indexOf('Contexto relacionado del mismo proyecto');
    expect(targetAt).toBeLessThan(sectionAt);
    expect(sectionAt).toBeLessThan(rulesAt);
    expect(sectionAt).toBeLessThan(relatedAt);
  });

  it('renders no header and no section when dependency context is absent or has empty text', () => {
    // Anclado a inicio de línea: la convención PHPUnit (WI-CORE-064) cita el título entre comillas.
    const header = /^Dependencias del código objetivo/m;
    expect(new PromptBuilder().build(phpContext())).not.toMatch(header);
    expect(new PromptBuilder().build(phpContext({ dependencyContext: dependencyContext('') }))).not.toMatch(header);
  });

  it('never renders the section for TypeScript even when the field is present', () => {
    const context = makeContext({
      metadata: { language: 'typescript', framework: 'VITEST' },
      dependencyContext: dependencyContext(sectionText),
    });

    expect(new PromptBuilder().build(context)).not.toContain('Dependencias del código objetivo');
  });
});

describe('PromptBuilder PHP final mark (WI-CORE-058)', () => {
  it('includes the final mark produced by the dependency section in the PHP prompt', () => {
    const text = [
      'Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`):',
      '- RenewalDatePolicy → Pilot\\Subscriptions\\Contracts\\RenewalDatePolicy (constructor) — final: no se puede mockear; usa una instancia real (new, o un caso si es un enum)',
    ].join('\n');
    const context = makeContext({
      target: {
        filePath: 'src/Services/RenewalService.php',
        symbolName: 'RenewalService',
        methodName: 'renew',
        targetType: 'METHOD',
        content: 'public function renew(): void {}',
      },
      metadata: { language: 'php', framework: 'PHPUNIT' },
      dependencyContext: {
        entries: [
          {
            typeName: 'RenewalDatePolicy',
            fqcn: 'Pilot\\Subscriptions\\Contracts\\RenewalDatePolicy',
            origin: 'CONSTRUCTOR',
            resolvedBy: 'SAME_NAMESPACE',
            final: true,
          },
        ],
        unresolvedCount: 0,
        tokenCount: 30,
        truncated: false,
        text,
      },
    });

    const prompt = new PromptBuilder().build(context);

    expect(prompt).toContain('— final: no se puede mockear; usa una instancia real (new, o un caso si es un enum)');
  });
});

describe('PromptBuilder PHPUnit conventions (WI-CORE-064)', () => {
  const LINES = PHP_PHPUNIT_CONVENTION_LINES;
  const phpTarget = {
    filePath: 'src/Services/RenewalService.php',
    symbolName: 'RenewalService',
    methodName: 'renew',
    targetType: 'METHOD' as const,
    content: 'public function renew(): void {}',
  };
  const phpBase = (overrides: Partial<GenerationContext> = {}): GenerationContext =>
    makeContext({
      target: phpTarget,
      metadata: { language: 'php', framework: 'PHPUNIT' },
      ...overrides,
    });
  const options = {
    testNamespace: 'Tests\\Unit\\Services',
    testPath: 'tests/Unit/Services/RenewalServiceRenewTest.php',
  };

  it('exports the prompt version constant (i)', () => {
    expect(PHP_PROMPT_CONVENTIONS_VERSION).toBe('php-prompt-2026-10-14.2');
  });

  it('exports exactly the three convention lines in the agreed wording (v)', () => {
    expect(LINES).toHaveLength(3);
    expect(LINES[0]).toBe(
      'PHPUnit: compara objetos de valor (p. ej. `DateTimeImmutable`) con `assertEquals`; usa `assertSame` solo para escalares o identidad del mismo objeto.',
    );
    expect(LINES[1]).toBe(
      'No uses `createMock`/`createStub`/`getMockBuilder` con clases `final` ni enums: instáncialas con `new`; crea dobles solo de interfaces o clases no `final`.',
    );
    expect(LINES[2]).toBe(
      'En los `use` pon solo FQCN presentes en el código y el contexto disponibles (incl. «Dependencias del código objetivo»); no inventes namespaces.',
    );
  });

  it('inserts the three lines as own sections right after the Extiende line and before the location line (i)', () => {
    const prompt = new PromptBuilder().build(phpBase(), options);
    const parts = prompt.split('\n\n');
    const extendsAt = parts.findIndex((p) => p.startsWith('Extiende `Tests\\TestCase`'));
    expect(extendsAt).toBeGreaterThan(-1);
    expect(parts.slice(extendsAt + 1, extendsAt + 1 + LINES.length)).toEqual([...LINES]);
    expect(parts[extendsAt + 1 + LINES.length]).toBe(
      `El archivo debe estar en ${options.testPath} y declarar el namespace ${options.testNamespace}.`,
    );
    expect(prompt).toContain(LINES[0]);
  });

  it('keeps the rest of the PHP prompt identical when the three lines are removed (iv)', () => {
    const prompt = new PromptBuilder().build(phpBase(), options);
    const previous = [
      'Eres un ingeniero de software senior escribiendo pruebas unitarias en PHP.',
      'Objetivo: escribir una prueba unitaria para el método "RenewalService.renew" en src/Services/RenewalService.php.',
      'Usa PHPUnit 11 como framework de pruebas. Escribe un archivo PHP completo: debe empezar con `<?php`, puede declarar `declare(strict_types=1);`, declarar el namespace del test y usar `use` con el namespace completo de cada clase del proyecto que necesites.',
      'Extiende `Tests\\TestCase` solo si el código objetivo usa el contenedor de Laravel (helpers como `config()` o `app()`, o facades `Illuminate\\Support\\Facades\\...`). Si no lo usa, extiende `PHPUnit\\Framework\\TestCase`.',
      `El archivo debe estar en ${options.testPath} y declarar el namespace ${options.testNamespace}.`,
      'Código objetivo:',
      '```php',
      'public function renew(): void {}',
      '```',
      'Reglas funcionales',
    ];
    const stripped = LINES.reduce((text, line) => text.replace(`${line}\n\n`, ''), prompt);
    expect(stripped.split('\n\n').slice(0, 7)).toEqual(previous.slice(0, 7));
    expect(stripped.startsWith(previous[0])).toBe(true);
    expect(stripped).toContain(
      'Responde ÚNICAMENTE con código PHP válido, empezando por `<?php`. No incluyas explicaciones ni comentarios de proceso. No envuelvas la respuesta en fences de markdown.',
    );
  });

  it('keeps the TypeScript prompt byte-identical to the previous construction (iii)', () => {
    const prompt = new PromptBuilder().build(makeContext());
    const expected = [
      'Eres un ingeniero de software senior escribiendo pruebas unitarias en TypeScript.',
      'Objetivo: escribir una prueba unitaria para el método "Foo.bar" en src/foo.ts.',
      'Usa el framework de pruebas VITEST.',
      'Código objetivo:',
      '```ts',
      'bar(): number { return 1; }',
      '```',
      'Responde ÚNICAMENTE con código TypeScript válido (imports + bloques de prueba). No incluyas explicaciones ni comentarios de proceso. No envuelvas la respuesta en fences de markdown.',
    ].join('\n\n');
    expect(prompt).toBe(expected);
    expect(prompt).not.toContain(LINES[0]);
  });

  it('keeps dependency, functional rules and related context in their positions (vi)', () => {
    const sectionText = 'Dependencias del código objetivo (orden de inserción):\n- RenewalDatePolicy';
    const prompt = new PromptBuilder().build(
      phpBase({
        dependencyContext: {
          entries: [],
          unresolvedCount: 0,
          tokenCount: 1,
          truncated: false,
          text: sectionText,
        },
        functionalRules: [
          {
            knowledgeId: 'rule-1',
            scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
            normalizedRule: 'Regla de prueba PHP.',
            scope: 'METHOD',
            targetRef: 'src/Services/RenewalService.php::renew',
            source: 'HUMAN_ANSWER',
            provenance: { confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null },
          },
        ],
        relatedChunks: [
          {
            filePath: 'src/Other.php',
            symbolKind: 'CLASS',
            symbolName: 'Other',
            parentSymbolName: null,
            content: 'class Other {}',
            score: 0.9,
            matchedVia: ['SEMANTIC'],
          },
        ],
      }),
      options,
    );
    const targetAt = prompt.indexOf('public function renew(): void {}');
    const conventionAt = prompt.indexOf(LINES[2]);
    const sectionAt = prompt.indexOf(sectionText);
    const rulesAt = prompt.indexOf('Reglas funcionales');
    const relatedAt = prompt.indexOf('Contexto relacionado del mismo proyecto');
    expect(targetAt).toBeLessThan(sectionAt);
    expect(sectionAt).toBeLessThan(rulesAt);
    expect(rulesAt).toBeLessThan(relatedAt);
    expect(conventionAt).toBeLessThan(prompt.indexOf('Código objetivo:'));
  });
});
