import { describe, expect, it } from 'vitest';
import {
  applyDependencyTokenCap,
  countPhpDependencyTokens,
  extractPhpConstructorSignature,
  renderPhpDependencySection,
  type PhpDependencyEntry,
} from './php-dependency-context.js';

const PLAN = 'Pilot\\Subscriptions\\Domain\\Plan';

describe('extractPhpConstructorSignature (WI-CORE-065)', () => {
  it('conserva modificadores promovidos, tipos, nombres y valores por defecto', () => {
    expect(
      extractPhpConstructorSignature(
        'public function __construct(public string $code, public float $monthlyPrice = 0.0) {}',
      ),
    ).toBe('(public string $code, public float $monthlyPrice = 0.0)');
  });

  it('respeta paréntesis anidados de valores por defecto como new Foo() y arrays', () => {
    expect(
      extractPhpConstructorSignature(
        'public function __construct(private Clock $clock = new SystemClock(), array $opts = array(1, 2), ?string $name = null) {}',
      ),
    ).toBe('(private Clock $clock = new SystemClock(), array $opts = array(1, 2), ?string $name = null)');
  });

  it('no parte cadenas por comas ni paréntesis', () => {
    expect(extractPhpConstructorSignature("public function __construct(string $sep = ', (x)', int $n = 1) {}")).toBe(
      "(string $sep = ', (x)', int $n = 1)",
    );
  });

  it('normaliza saltos de línea y espacios a un solo espacio', () => {
    const content = [
      'public function __construct(',
      '        public readonly string $code,',
      '        public float $monthlyPrice,',
      '    ) {}',
    ].join('\n');

    expect(extractPhpConstructorSignature(content)).toBe('(public readonly string $code, public float $monthlyPrice)');
  });

  it('elimina atributos #[...] de la firma y del propio constructor', () => {
    expect(
      extractPhpConstructorSignature(
        '#[Attr(["a", "b"])] public function __construct(#[SensitiveParameter] string $secret, private Foo $foo) {}',
      ),
    ).toBe('(string $secret, private Foo $foo)');
  });

  it('elimina comentarios de línea y de bloque', () => {
    const content = 'public function __construct(\n  // principal\n  string $code, /* auxiliar */ float $m\n) {}';

    expect(extractPhpConstructorSignature(content)).toBe('(string $code, float $m)');
  });

  it('no incluye el cuerpo ni el tipo de retorno', () => {
    expect(extractPhpConstructorSignature('public function __construct(int $a): void { $this->a = $a; }')).toBe(
      '(int $a)',
    );
  });

  it('devuelve paréntesis vacíos para un constructor sin parámetros', () => {
    expect(extractPhpConstructorSignature('public function __construct() {}')).toBe('()');
  });

  it('devuelve null si no hay constructor', () => {
    expect(extractPhpConstructorSignature('public function renew(): void {}')).toBeNull();
    expect(extractPhpConstructorSignature('class RenewalDatePolicy {}')).toBeNull();
  });

  it('devuelve null para contenido no legible sin lanzar', () => {
    expect(extractPhpConstructorSignature('')).toBeNull();
    expect(extractPhpConstructorSignature('function __construct(')).toBeNull();
    expect(extractPhpConstructorSignature('function __construct(string $a')).toBeNull();
    expect(extractPhpConstructorSignature('\u0000 %%% ))(( ')).toBeNull();
    expect(() => extractPhpConstructorSignature(null as unknown as string)).not.toThrow();
    expect(extractPhpConstructorSignature(null as unknown as string)).toBeNull();
  });
});

describe('renderPhpDependencySection with constructor signature (WI-CORE-065)', () => {
  it('agrega la firma al final de la línea de la entrada', () => {
    const entries: PhpDependencyEntry[] = [
      {
        typeName: 'Plan',
        fqcn: PLAN,
        origin: 'METHOD_SIGNATURE',
        resolvedBy: 'IMPORT',
        signature: '(public string $code, public float $monthlyPrice)',
      },
    ];

    expect(renderPhpDependencySection(entries).split('\n').at(-1)).toBe(
      `- Plan → ${PLAN} (firma del método) — constructor(public string $code, public float $monthlyPrice)`,
    );
  });

  it('no agrega nada a entradas sin firma', () => {
    const entries: PhpDependencyEntry[] = [
      { typeName: 'Plan', fqcn: PLAN, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT' },
    ];

    expect(renderPhpDependencySection(entries).split('\n').at(-1)).toBe(`- Plan → ${PLAN} (constructor)`);
  });
});

describe('applyDependencyTokenCap with constructor signatures (WI-CORE-065)', () => {
  const signature = '(public string $alphaParameterNumberOne, public string $betaParameterNumberTwo, public string $gammaParameterNumberThree)';
  const withSignatures = (count: number): PhpDependencyEntry[] =>
    Array.from({ length: count }, (_, index) => ({
      typeName: `P${index + 1}`,
      fqcn: `Pilot\\Domain\\P${index + 1}`,
      origin: 'CONSTRUCTOR',
      resolvedBy: 'IMPORT',
      signature,
    }));

  it('retira firmas desde la última entrada hacia atrás, conserva nombres y marca truncated', () => {
    const entries = withSignatures(10);
    expect(countPhpDependencyTokens(renderPhpDependencySection(entries))).toBeGreaterThan(300);

    const capped = applyDependencyTokenCap(entries, 300);

    expect(capped.truncated).toBe(true);
    expect(capped.entries.map((entry) => entry.typeName)).toEqual(entries.map((entry) => entry.typeName));
    const withSig = capped.entries.filter((entry) => entry.signature !== undefined).length;
    expect(withSig).toBeGreaterThan(0);
    expect(withSig).toBeLessThan(10);
    expect(capped.entries.slice(0, withSig).every((entry) => entry.signature !== undefined)).toBe(true);
    expect(capped.entries.slice(withSig).every((entry) => entry.signature === undefined)).toBe(true);
    expect(capped.tokenCount).toBeLessThanOrEqual(300);
    expect(capped.tokenCount).toBe(countPhpDependencyTokens(renderPhpDependencySection(capped.entries)));
  });

  it('no recorta ni marca cuando las firmas caben', () => {
    const entries = withSignatures(2);

    const capped = applyDependencyTokenCap(entries, 300);

    expect(capped.truncated).toBe(false);
    expect(capped.entries).toEqual(entries);
  });
});
