import { describe, expect, it } from 'vitest';
import {
  applyDependencyTokenCap,
  countPhpDependencyTokens,
  renderPhpDependencySection,
  resolvePhpDependencies,
  type PhpDependencyEntry,
  type ResolvePhpDependenciesInput,
} from './php-dependency-context.js';

const NS = 'Pilot\\Subscriptions\\Services';
const DECLARING = `${NS}\\RenewalService`;
const CONTRACTS = 'Pilot\\Subscriptions\\Contracts';
const DOMAIN = 'Pilot\\Subscriptions\\Domain';

function input(overrides: Partial<ResolvePhpDependenciesInput> = {}): ResolvePhpDependenciesInput {
  return {
    declaringClass: DECLARING,
    classImports: [],
    constructorChunk: null,
    methodChunk: { content: 'public function run(): void {}', importsUsed: [] },
    knownTypes: new Set<string>(),
    ...overrides,
  };
}

const RENEWAL_FIXTURE = (): ResolvePhpDependenciesInput => ({
  declaringClass: DECLARING,
  classImports: [`${CONTRACTS}\\PaymentGateway`, `${CONTRACTS}\\SubscriptionRepository`, `${DOMAIN}\\Subscription`],
  constructorChunk: {
    content:
      'public function __construct(private PaymentGateway $payments, private SubscriptionRepository $subscriptions, private RenewalDatePolicy $dates) {}',
    importsUsed: [`${CONTRACTS}\\PaymentGateway`, `${CONTRACTS}\\SubscriptionRepository`],
  },
  methodChunk: {
    content: 'public function renew(Subscription $subscription): void { $this->payments->charge($subscription); }',
    importsUsed: [`${DOMAIN}\\Subscription`],
  },
  knownTypes: new Set([`${NS}\\RenewalDatePolicy`, `${DOMAIN}\\Subscription`]),
});

describe('resolvePhpDependencies', () => {
  it('resuelve el fixture RenewalService con FQCN correctos y SAME_NAMESPACE para RenewalDatePolicy', () => {
    const result = resolvePhpDependencies(RENEWAL_FIXTURE());

    expect(result).toEqual({
      entries: [
        { typeName: 'PaymentGateway', fqcn: `${CONTRACTS}\\PaymentGateway`, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT' },
        { typeName: 'SubscriptionRepository', fqcn: `${CONTRACTS}\\SubscriptionRepository`, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT' },
        { typeName: 'RenewalDatePolicy', fqcn: `${NS}\\RenewalDatePolicy`, origin: 'CONSTRUCTOR', resolvedBy: 'SAME_NAMESPACE' },
        { typeName: 'Subscription', fqcn: `${DOMAIN}\\Subscription`, origin: 'METHOD_SIGNATURE', resolvedBy: 'IMPORT' },
      ],
      unresolvedCount: 0,
      truncated: false,
    });
    expect(result.entries.some((entry) => entry.fqcn === `${CONTRACTS}\\RenewalDatePolicy`)).toBe(false);
  });

  it('devuelve vacío sin dependencias', () => {
    expect(resolvePhpDependencies(input())).toEqual({ entries: [], unresolvedCount: 0, truncated: false });
  });

  it('no resuelve un alias de use porque el último segmento no coincide', () => {
    const result = resolvePhpDependencies(
      input({
        classImports: ['Vendor\\Lib\\Mailer as Gateway'],
        methodChunk: { content: 'public function send(Gateway $g): void {}', importsUsed: [] },
      }),
    );

    expect(result.entries).toEqual([]);
    expect(result.unresolvedCount).toBe(1);
  });

  it('cuenta como no resuelto un tipo del mismo namespace que no está en knownTypes, sin listarlo', () => {
    const result = resolvePhpDependencies(
      input({
        methodChunk: { content: 'public function run(Mystery $m): void {}', importsUsed: [] },
        knownTypes: new Set(),
      }),
    );

    expect(result.entries).toEqual([]);
    expect(result.unresolvedCount).toBe(1);
  });

  it('soporta nullable, uniones, literales FQ con barra inicial y tipo de retorno', () => {
    const result = resolvePhpDependencies(
      input({
        classImports: [`${DOMAIN}\\Subscription`, `${CONTRACTS}\\PaymentGateway`, `${CONTRACTS}\\SubscriptionRepository`],
        methodChunk: {
          content:
            'public function f(?Subscription $s, PaymentGateway|SubscriptionRepository $x, \\Vendor\\Pkg\\Thing $t): ?Subscription {}',
          importsUsed: [],
        },
      }),
    );

    expect(result.entries).toEqual([
      { typeName: 'Subscription', fqcn: `${DOMAIN}\\Subscription`, origin: 'METHOD_SIGNATURE', resolvedBy: 'IMPORT' },
      { typeName: 'PaymentGateway', fqcn: `${CONTRACTS}\\PaymentGateway`, origin: 'METHOD_SIGNATURE', resolvedBy: 'IMPORT' },
      { typeName: 'SubscriptionRepository', fqcn: `${CONTRACTS}\\SubscriptionRepository`, origin: 'METHOD_SIGNATURE', resolvedBy: 'IMPORT' },
      { typeName: 'Thing', fqcn: 'Vendor\\Pkg\\Thing', origin: 'METHOD_SIGNATURE', resolvedBy: 'LITERAL' },
    ]);
    expect(result.unresolvedCount).toBe(0);
  });

  it('soporta intersecciones A&B', () => {
    const result = resolvePhpDependencies(
      input({
        classImports: [`${CONTRACTS}\\Countable`, `${CONTRACTS}\\Named`],
        methodChunk: { content: 'public function f(Countable&Named $c): void {}', importsUsed: [] },
      }),
    );

    expect(result.entries.map((entry) => entry.fqcn)).toEqual([`${CONTRACTS}\\Countable`, `${CONTRACTS}\\Named`]);
  });

  it('ignora escalares, pseudo-tipos y clases globales internas no importadas', () => {
    const result = resolvePhpDependencies(
      input({
        methodChunk: {
          content:
            'public function f(int $a, string $b, DateTimeImmutable $c, array $d, ?bool $e, callable $f, self $g, mixed $h): ?self {}',
          importsUsed: [],
        },
      }),
    );

    expect(result).toEqual({ entries: [], unresolvedCount: 0, truncated: false });
  });

  it('ignora literales de clases globales internas (\\DateTimeImmutable, \\InvalidArgumentException) sin contarlos', () => {
    const result = resolvePhpDependencies(
      input({
        methodChunk: {
          content: 'public function f(\\DateTimeImmutable $c, \\InvalidArgumentException $e): \\InvalidArgumentException {}',
          importsUsed: [],
        },
      }),
    );

    expect(result).toEqual({ entries: [], unresolvedCount: 0, truncated: false });
  });

  it('mantiene como LITERAL un literal calificado aunque su último segmento coincida con una clase global', () => {
    const result = resolvePhpDependencies(
      input({
        methodChunk: { content: 'public function f(\\Vendor\\Pkg\\Thing $t): void {}', importsUsed: [] },
      }),
    );

    expect(result.entries).toEqual([
      { typeName: 'Thing', fqcn: 'Vendor\\Pkg\\Thing', origin: 'METHOD_SIGNATURE', resolvedBy: 'LITERAL' },
    ]);
  });

  it('deduplica por FQCN dando prioridad al constructor', () => {
    const result = resolvePhpDependencies(
      input({
        classImports: [`${CONTRACTS}\\PaymentGateway`],
        constructorChunk: {
          content: 'public function __construct(private PaymentGateway $payments) {}',
          importsUsed: [`${CONTRACTS}\\PaymentGateway`],
        },
        methodChunk: { content: 'public function renew(PaymentGateway $p): void {}', importsUsed: [] },
      }),
    );

    expect(result.entries).toEqual([
      { typeName: 'PaymentGateway', fqcn: `${CONTRACTS}\\PaymentGateway`, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT' },
    ]);
  });

  it('limita a 20 entradas y marca truncated sin contar los recortados como no resueltos', () => {
    const names = Array.from({ length: 25 }, (_, index) => `Type${String(index + 1).padStart(2, '0')}`);
    const params = names.map((name) => `${name} $${name.toLowerCase()}`).join(', ');
    const result = resolvePhpDependencies(
      input({
        classImports: names.map((name) => `${CONTRACTS}\\${name}`),
        methodChunk: { content: `public function run(${params}): void {}`, importsUsed: [] },
      }),
    );

    expect(result.entries).toHaveLength(20);
    expect(result.entries[0]?.typeName).toBe('Type01');
    expect(result.truncated).toBe(true);
    expect(result.unresolvedCount).toBe(0);
  });

  it('no incluye la sección ni tokens cuando no hay entradas', () => {
    expect(renderPhpDependencySection([])).toBe('');
    expect(countPhpDependencyTokens('')).toBe(0);
  });
});

describe('renderPhpDependencySection', () => {
  it('renderiza el encabezado y una línea por entrada', () => {
    const entries: PhpDependencyEntry[] = [
      { typeName: 'PaymentGateway', fqcn: `${CONTRACTS}\\PaymentGateway`, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT' },
      { typeName: 'Subscription', fqcn: `${DOMAIN}\\Subscription`, origin: 'METHOD_SIGNATURE', resolvedBy: 'IMPORT' },
    ];

    expect(renderPhpDependencySection(entries)).toBe(
      [
        'Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`):',
        `- PaymentGateway → ${CONTRACTS}\\PaymentGateway (constructor)`,
        `- Subscription → ${DOMAIN}\\Subscription (firma del método)`,
      ].join('\n'),
    );
  });
});

describe('applyDependencyTokenCap', () => {
  function longEntries(count: number): PhpDependencyEntry[] {
    return Array.from({ length: count }, (_, index) => {
      const typeName = `VeryLongDependencyTypeName${String(index + 1).padStart(4, '0')}`;
      return { typeName, fqcn: `Pilot\\Subscriptions\\Contracts\\Nested\\${typeName}`, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT' };
    });
  }

  it('recorta por el final hasta que el texto renderizado cabe en 300 tokens', () => {
    const entries = longEntries(20);

    const capped = applyDependencyTokenCap(entries, 300);

    expect(capped.truncated).toBe(true);
    expect(capped.entries.length).toBeLessThan(20);
    expect(capped.entries).toEqual(entries.slice(0, capped.entries.length));
    expect(capped.tokenCount).toBeLessThanOrEqual(300);
    expect(capped.tokenCount).toBe(countPhpDependencyTokens(renderPhpDependencySection(capped.entries)));
  });

  it('no recorta cuando cabe y devuelve tokenCount 0 sin entradas', () => {
    const entries = longEntries(2);

    expect(applyDependencyTokenCap(entries, 300)).toMatchObject({ entries, truncated: false });
    expect(applyDependencyTokenCap([], 300)).toEqual({ entries: [], truncated: false, tokenCount: 0 });
  });
});
