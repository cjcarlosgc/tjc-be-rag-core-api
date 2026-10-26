import { describe, expect, it } from 'vitest';
import {
  applyDependencyTokenCap,
  capPhpDependencySection,
  countPhpDependencyTokens,
  extractPhpConstructorVisibility,
  extractPhpPublicStaticFactories,
  MAX_PHP_DEPENDENCY_TOKENS,
  renderPhpDependencySection,
  type PhpDependencyEntry,
} from './php-dependency-context.js';

const MONEY = 'Brick\\Money\\Money';

function entry(overrides: Partial<PhpDependencyEntry> = {}): PhpDependencyEntry {
  return {
    typeName: 'Money',
    fqcn: MONEY,
    origin: 'CONSTRUCTOR',
    resolvedBy: 'IMPORT',
    ...overrides,
  };
}

describe('MAX_PHP_DEPENDENCY_TOKENS (WI-CORE-104)', () => {
  it('es 500 para toda la sección', () => {
    expect(MAX_PHP_DEPENDENCY_TOKENS).toBe(500);
  });
});

describe('extractPhpConstructorVisibility (WI-CORE-104, R2a)', () => {
  it.each([
    ['private', 'private function __construct(private string $a) {}', 'private'],
    ['protected', 'protected function __construct() {}', 'protected'],
    ['public', 'public function __construct(int $a) {}', 'public'],
    ['sin modificador de visibilidad', 'function __construct(int $a) {}', 'public'],
    ['con final', 'final private function __construct() {}', 'private'],
    ['mayúsculas', 'PRIVATE FUNCTION __construct() {}', 'private'],
  ])('%s', (_name, content, expected) => {
    expect(extractPhpConstructorVisibility(content)).toBe(expected);
  });

  it('ignora docblocks, comentarios y atributos antes de los modificadores', () => {
    const content = [
      '/**',
      ' * public function __construct() {}',
      ' */',
      '// protected function __construct() {}',
      "#[SomeAttribute(['a' => 'public'])]",
      '#[Other]',
      'private function __construct(private int $a) {',
      '}',
    ].join('\n');

    expect(extractPhpConstructorVisibility(content)).toBe('private');
  });

  it('devuelve null si no es legible, no hay constructor o hay visibilidades contradictorias', () => {
    expect(extractPhpConstructorVisibility('')).toBeNull();
    expect(extractPhpConstructorVisibility('}{ basura (((')).toBeNull();
    expect(extractPhpConstructorVisibility('public function other() {}')).toBeNull();
    expect(extractPhpConstructorVisibility('public private function __construct() {}')).toBeNull();
    expect(extractPhpConstructorVisibility('/* sin cerrar private function __construct() {}')).toBeNull();
    expect(() => extractPhpConstructorVisibility(undefined as unknown as string)).not.toThrow();
    expect(extractPhpConstructorVisibility(undefined as unknown as string)).toBeNull();
  });
});

describe('extractPhpPublicStaticFactories (WI-CORE-104, R2a)', () => {
  it('lee fábricas públicas estáticas con retorno static, self, nombre corto, FQCN y nullable', () => {
    expect(
      extractPhpPublicStaticFactories(
        'public static function of(BigNumber|int|string $amount, Currency|string $currency, ?Context $context = null, RoundingMode $roundingMode = RoundingMode::UNNECESSARY): static\n{\n return new static();\n}',
        MONEY,
      ),
    ).toEqual([
      'of(BigNumber|int|string $amount, Currency|string $currency, ?Context $context = null, RoundingMode $roundingMode = RoundingMode::UNNECESSARY): static',
    ]);
    expect(extractPhpPublicStaticFactories('public static function zero(Currency $c): self { }', MONEY)).toEqual([
      'zero(Currency $c): self',
    ]);
    expect(extractPhpPublicStaticFactories('public static function a(): Money {}', MONEY)).toEqual(['a(): Money']);
    expect(extractPhpPublicStaticFactories('public static function b(): ?Money {}', MONEY)).toEqual(['b(): ?Money']);
    expect(extractPhpPublicStaticFactories('public static function c(): \\Brick\\Money\\Money {}', MONEY)).toEqual([
      'c(): \\Brick\\Money\\Money',
    ]);
    expect(extractPhpPublicStaticFactories('public static function d(): Brick\\Money\\Money {}', MONEY)).toEqual([
      'd(): Brick\\Money\\Money',
    ]);
    expect(extractPhpPublicStaticFactories('public static function e(): ?static {}', MONEY)).toEqual(['e(): ?static']);
  });

  it('ignora docblock y atributos y normaliza los espacios de los parámetros', () => {
    const content = '/** Crea. */\n#[Pure]\npublic  static   function  make(\n    int   $a,\n    // nota\n    string $b = "x"\n) : static {\n}';

    expect(extractPhpPublicStaticFactories(content, MONEY)).toEqual(['make(int $a, string $b = "x"): static']);
  });

  it.each([
    ['método no estático', 'public function of(): static {}'],
    ['método no público', 'private static function of(): static {}'],
    ['protegido', 'protected static function of(): static {}'],
    ['sin visibilidad explícita', 'static function of(): static {}'],
    ['abstracto', 'abstract public static function of(): static;'],
    ['retorno de otro tipo', 'public static function of(): Currency {}'],
    ['retorno escalar', 'public static function of(): string {}'],
    ['sin tipo de retorno', 'public static function of() {}'],
    ['unión de tipos', 'public static function of(): static|null {}'],
    ['método mágico', 'public static function __set_state(array $a): static {}'],
    ['clase distinta con mismo sufijo', 'public static function of(): OtherMoney {}'],
    ['ilegible', 'public static function of(int $a'],
    ['vacío', ''],
  ])('descarta: %s', (_name, content) => {
    expect(extractPhpPublicStaticFactories(content, MONEY)).toEqual([]);
  });

  it('nunca lanza con entradas inválidas', () => {
    expect(() => extractPhpPublicStaticFactories(undefined as unknown as string, MONEY)).not.toThrow();
    expect(() => extractPhpPublicStaticFactories('public static function x(): static {}', undefined as unknown as string)).not.toThrow();
  });
});

describe('renderPhpDependencySection con constructor no público (WI-CORE-104, R2a)', () => {
  it('Money-like: constructor privado, fábricas, sin firma y sin «con new» en la marca de final', () => {
    const line = renderPhpDependencySection([
      entry({
        final: true,
        constructorVisibility: 'private',
        factories: ['of(...): static', 'zero(...): static'],
        signature: '(private BigDecimal $amount)',
      }),
    ])
      .split('\n')
      .at(-1);

    expect(line).toBe(
      `- Money → ${MONEY} (constructor) — final: no se puede mockear — constructor privado: no uses new; fábricas públicas: of(...): static, zero(...): static`,
    );
    expect(line).not.toContain('con new');
    expect(line).not.toContain('private BigDecimal');
  });

  it('constructor protegido sin fábricas y clase no final: solo el aviso', () => {
    const line = renderPhpDependencySection([entry({ constructorVisibility: 'protected', factories: [] })])
      .split('\n')
      .at(-1);

    expect(line).toBe(`- Money → ${MONEY} (constructor) — constructor protegido: no uses new`);
  });

  it('con constructor público o sin información el render es el de siempre (incluida la marca de final con «con new»)', () => {
    expect(renderPhpDependencySection([entry({ final: true, signature: '(int $a)' })]).split('\n').at(-1)).toBe(
      `- Money → ${MONEY} (constructor) — final: no se puede mockear; usa una instancia real con new — constructor(int $a)`,
    );
    expect(renderPhpDependencySection([entry({ final: true })]).split('\n').at(-1)).toBe(
      `- Money → ${MONEY} (constructor) — final: no se puede mockear; usa una instancia real con new`,
    );
    expect(renderPhpDependencySection([entry()]).split('\n').at(-1)).toBe(`- Money → ${MONEY} (constructor)`);
  });

  it('el enum no cambia aunque llevara visibilidad', () => {
    const line = renderPhpDependencySection([
      entry({ typeName: 'Status', fqcn: 'A\\Status', final: true, enum: true, constructorVisibility: 'private', factories: ['x(): static'] }),
    ])
      .split('\n')
      .at(-1);

    expect(line).toBe('- Status → A\\Status (constructor) — enum: no se puede mockear ni instanciar con new; usa un caso (Enum::Caso)');
  });
});

describe('recorte con fábricas (WI-CORE-104)', () => {
  const factories = Array.from({ length: 4 }, (_, i) => `factory${i}(${Array.from({ length: 12 }, (_, j) => `int $p${j}`).join(', ')}): static`);

  it('retira las fábricas desde la última entrada y conserva el aviso de constructor no público', () => {
    const entries = [
      entry({ typeName: 'A', fqcn: 'N\\A', constructorVisibility: 'private', factories }),
      entry({ typeName: 'B', fqcn: 'N\\B', constructorVisibility: 'private', factories }),
    ];
    const full = countPhpDependencyTokens(renderPhpDependencySection(entries));
    // Cabe con las fábricas de A pero no con las de las dos entradas.
    const capped = applyDependencyTokenCap(entries, full - 5);

    expect(capped.truncated).toBe(true);
    expect(capped.entries.map((e) => e.typeName)).toEqual(['A', 'B']);
    expect(capped.entries[0].factories).toEqual(factories);
    expect(capped.entries[1].factories).toEqual([]);
    const text = renderPhpDependencySection(capped.entries);
    expect(text.split('\n').at(-1)).toBe('- B → N\\B (constructor) — constructor privado: no uses new');
    expect(capped.tokenCount).toBeLessThanOrEqual(full - 5);
  });

  it('retira las fábricas antes que las firmas de constructor y las firmas antes que las entradas', () => {
    const entries = [
      entry({ typeName: 'A', fqcn: 'N\\A', constructorVisibility: 'private', factories }),
      entry({ typeName: 'B', fqcn: 'N\\B', signature: `(${Array.from({ length: 40 }, (_, j) => `int $q${j}`).join(', ')})` }),
    ];
    const full = countPhpDependencyTokens(renderPhpDependencySection(entries));
    const withoutFactories = countPhpDependencyTokens(
      renderPhpDependencySection([{ ...entries[0], factories: [] }, entries[1]]),
    );

    const factoriesOnly = capPhpDependencySection(entries, [], withoutFactories);
    expect(factoriesOnly.entries[0].factories).toEqual([]);
    expect(factoriesOnly.entries[1].signature).toBeDefined();

    const signatureToo = capPhpDependencySection(entries, [], withoutFactories - 1);
    expect(signatureToo.entries[1].signature).toBeUndefined();
    expect(signatureToo.entries.map((e) => e.typeName)).toEqual(['A', 'B']);
    expect(full).toBeGreaterThan(withoutFactories);
  });

  it('quitar la firma de una entrada con constructor no público no cuenta como recorte', () => {
    const only = entry({ constructorVisibility: 'private', factories: [], signature: '(int $a)' });
    const capped = applyDependencyTokenCap([only], 500);

    expect(capped.truncated).toBe(false);
  });
});
