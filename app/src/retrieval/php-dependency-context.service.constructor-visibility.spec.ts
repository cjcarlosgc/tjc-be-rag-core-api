import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';

const NS = 'App\\Billing';
const DECLARING = `${NS}\\Checkout`;
const MONEY = 'Brick\\Money\\Money';
const CURRENCY = 'Brick\\Money\\Currency';
const GATEWAY = `${NS}\\Gateway`;
const DECIMAL = 'Brick\\Math\\BigDecimal';
const FILE = 'src/Checkout.php';

interface Chunk {
  filePath: string;
  symbolKind: string;
  symbolName: string;
  parentSymbolName: string | null;
  importsUsed: string[];
  content: string;
}

function ctor(parent: string, content: string, importsUsed: string[] = []): Chunk {
  return { filePath: `src/${parent}.php`, symbolKind: 'CONSTRUCTOR', symbolName: '__construct', parentSymbolName: parent, importsUsed, content };
}

function cls(name: string, content: string): Chunk {
  return { filePath: `src/${name}.php`, symbolKind: 'CLASS', symbolName: name, parentSymbolName: null, importsUsed: [], content };
}

function method(parent: string, name: string, content: string): Chunk {
  return { filePath: `src/${parent}.php`, symbolKind: 'METHOD', symbolName: `${parent}::${name}`, parentSymbolName: parent, importsUsed: [], content };
}

const methodChunk = {
  filePath: FILE,
  symbolKind: 'METHOD',
  symbolName: `${DECLARING}::pay`,
  parentSymbolName: DECLARING,
  importsUsed: [],
  content: 'public function pay(): void {}',
};

function makeRepository(options: {
  chunks: Chunk[];
  factoryError?: Error;
  staticMethods?: Array<{ parentSymbolName: string; symbolName: string | null; content: string }>;
}) {
  const fileChunks: Chunk[] = [
    {
      filePath: FILE,
      symbolKind: 'CLASS',
      symbolName: DECLARING,
      parentSymbolName: null,
      importsUsed: [MONEY, CURRENCY],
      content: 'class Checkout {}',
    },
    {
      filePath: FILE,
      symbolKind: 'CONSTRUCTOR',
      symbolName: '__construct',
      parentSymbolName: DECLARING,
      importsUsed: [MONEY, CURRENCY],
      content: `public function __construct(private Money $price, private Currency $currency, private Gateway $gateway) {}`,
    },
  ];
  const all = [...fileChunks, ...options.chunks];
  const classNames = all.filter((c) => c.symbolKind === 'CLASS').map((c) => c.symbolName);
  const findPhpStaticMethodDeclarations = options.factoryError
    ? vi.fn().mockRejectedValue(options.factoryError)
    : vi.fn().mockImplementation(async (_pv: string, parents: string[]) =>
        options.staticMethods
          ? options.staticMethods.filter((m) => parents.includes(m.parentSymbolName))
          : all
              .filter((c) => c.symbolKind === 'METHOD' && c.parentSymbolName !== null && parents.includes(c.parentSymbolName))
              .map((c) => ({ parentSymbolName: c.parentSymbolName as string, symbolName: c.symbolName, content: c.content })),
      );
  const repository = {
    findByFile: vi.fn().mockImplementation(async (_pv: string, filePath: string) => fileChunks.filter((c) => c.filePath === filePath)),
    findPhpTypeSymbolNames: vi.fn().mockResolvedValue(classNames),
    findPhpTypeDeclarations: vi.fn().mockImplementation(async (_pv: string, names: string[]) =>
      all
        .filter((c) => c.symbolKind === 'CLASS' && names.includes(c.symbolName))
        .map((c) => ({ symbolName: c.symbolName, symbolKind: c.symbolKind, content: c.content })),
    ),
    findPhpConstructorDeclarations: vi.fn().mockImplementation(async (_pv: string, parents: string[]) =>
      all
        .filter((c) => c.symbolKind === 'CONSTRUCTOR' && c.parentSymbolName !== null && parents.includes(c.parentSymbolName))
        .map((c) => ({ parentSymbolName: c.parentSymbolName as string, content: c.content, importsUsed: c.importsUsed })),
    ),
    findPhpStaticMethodDeclarations,
  } as unknown as CodeChunksRepository;
  return { findPhpStaticMethodDeclarations, service: new PhpDependencyContextService(repository) };
}

const moneyChunks = (): Chunk[] => [
  cls(MONEY, 'final class Money {}'),
  ctor(MONEY, 'private function __construct(private BigDecimal $amount, private Currency $currency) {}', [DECIMAL, CURRENCY]),
  method(MONEY, 'zero', 'public static function zero(Currency $currency): static { return new static(); }'),
  method(MONEY, 'of', 'public static function of(BigNumber|int|string $amount, Currency|string $currency): Money { }'),
  method(MONEY, 'ofMinor', 'public static function ofMinor(int $minor, Currency $currency): self { }'),
  method(MONEY, 'getAmount', 'public function getAmount(): BigDecimal { }'),
  method(MONEY, 'create', 'private static function create(int $a): static { }'),
  method(MONEY, 'currencyOf', 'public static function currencyOf(Money $m): Currency { }'),
  cls(CURRENCY, 'final class Currency {}'),
  ctor(CURRENCY, 'public function __construct(private string $code) {}'),
  cls(GATEWAY, 'class Gateway {}'),
  ctor(GATEWAY, 'protected function __construct(private string $url) {}'),
  cls(DECIMAL, 'final class BigDecimal {}'),
  ctor(DECIMAL, 'private function __construct(private string $value) {}'),
];

describe('PhpDependencyContextService R2a: constructor no público y fábricas (WI-CORE-104)', () => {
  it('constructor privado: constructorVisibility y fábricas válidas, ordenadas, sin firma ni «con new»', async () => {
    const { service, findPhpStaticMethodDeclarations } = makeRepository({ chunks: moneyChunks() });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const money = result?.entries.find((entry) => entry.typeName === 'Money');
    expect(money).toMatchObject({ constructorVisibility: 'private', final: true });
    expect(money?.factories).toEqual([
      'of(BigNumber|int|string $amount, Currency|string $currency): Money',
      'ofMinor(int $minor, Currency $currency): self',
      'zero(Currency $currency): static',
    ]);
    expect(money?.signature).toBeUndefined();
    expect(result?.text).toContain(
      `- Money → ${MONEY} (constructor) — final: no se puede mockear — constructor privado: no uses new; fábricas públicas: of(BigNumber|int|string $amount, Currency|string $currency): Money, ofMinor(int $minor, Currency $currency): self, zero(Currency $currency): static`,
    );
    const moneyLine = result?.text.split('\n').find((line) => line.startsWith('- Money'));
    expect(moneyLine).not.toContain('con new');
    // Solo las clases con constructor no público (Money y Gateway) se consultan, en una sola llamada.
    expect(findPhpStaticMethodDeclarations).toHaveBeenCalledTimes(1);
    expect(findPhpStaticMethodDeclarations.mock.calls[0][1].sort()).toEqual([GATEWAY, MONEY].sort());
  });

  it('constructor protegido sin fábricas: aviso sin lista de fábricas', async () => {
    const { service } = makeRepository({ chunks: moneyChunks() });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const gateway = result?.entries.find((entry) => entry.typeName === 'Gateway');
    expect(gateway).toMatchObject({ constructorVisibility: 'protected', factories: [] });
    expect(result?.text).toContain(`- Gateway → ${GATEWAY} (constructor) — constructor protegido: no uses new\n`.trimEnd());
    expect(result?.text.split('\n').find((line) => line.startsWith('- Gateway'))).not.toContain('fábricas');
  });

  it('constructor público: sin campos nuevos y con la firma de siempre', async () => {
    const { service } = makeRepository({ chunks: moneyChunks() });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const currency = result?.entries.find((entry) => entry.typeName === 'Currency');
    expect(currency).toBeDefined();
    expect(currency).not.toHaveProperty('constructorVisibility');
    expect(currency).not.toHaveProperty('factories');
    expect(currency?.signature).toBe('(private string $code)');
    expect(result?.text).toContain(
      `- Currency → ${CURRENCY} (constructor) — final: no se puede mockear; usa una instancia real con new — constructor(private string $code)`,
    );
  });

  it('sin constructor en el índice: sin campos nuevos ni consulta de fábricas', async () => {
    const chunks = moneyChunks().filter(
      (c) => !(c.symbolKind === 'CONSTRUCTOR' && [MONEY, CURRENCY, GATEWAY].includes(c.parentSymbolName ?? '')),
    );
    const { service, findPhpStaticMethodDeclarations } = makeRepository({ chunks });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    for (const entry of result?.entries ?? []) {
      expect(entry).not.toHaveProperty('constructorVisibility');
      expect(entry).not.toHaveProperty('factories');
    }
    expect(findPhpStaticMethodDeclarations).not.toHaveBeenCalled();
  });

  it('un error en la consulta de fábricas no se propaga: queda el aviso sin fábricas', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeRepository({ chunks: moneyChunks(), factoryError: new Error('connection refused: secreto-interno') });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const money = result?.entries.find((entry) => entry.typeName === 'Money');
    expect(money).toMatchObject({ constructorVisibility: 'private', factories: [] });
    expect(result?.text).toContain('— constructor privado: no uses new');
    expect(result?.text).not.toContain('fábricas públicas');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Fábricas de constructor no público omitidas'));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secreto-interno');
    warn.mockRestore();
  });

  it('máximo 4 fábricas por clase, en orden estable por nombre y sin duplicados', async () => {
    const staticMethods = ['zeta', 'beta', 'alpha', 'delta', 'gamma', 'alpha'].map((name) => ({
      parentSymbolName: MONEY,
      symbolName: `${MONEY}::${name}`,
      content: `public static function ${name}(int $a): static {}`,
    }));
    const { service } = makeRepository({ chunks: moneyChunks(), staticMethods });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.entries.find((entry) => entry.typeName === 'Money')?.factories).toEqual([
      'alpha(int $a): static',
      'beta(int $a): static',
      'delta(int $a): static',
      'gamma(int $a): static',
    ]);
  });

  it('un FQCN que el índice no confirma como CLASS (interfaz) no recibe visibilidad ni fábricas', async () => {
    const chunks = moneyChunks().map((c) => (c.symbolName === MONEY && c.symbolKind === 'CLASS' ? { ...c, symbolKind: 'INTERFACE' } : c));
    const { service } = makeRepository({ chunks });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const money = result?.entries.find((entry) => entry.typeName === 'Money');
    expect(money).toBeDefined();
    expect(money).not.toHaveProperty('constructorVisibility');
  });

  it('profundidad 2: las entradas transitivas no llevan visibilidad ni fábricas', async () => {
    const { service } = makeRepository({ chunks: moneyChunks() });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const decimal = result?.transitiveEntries.find((entry) => entry.typeName === 'BigDecimal');
    expect(decimal).toMatchObject({ via: 'Money' });
    expect(decimal).not.toHaveProperty('constructorVisibility');
    expect(decimal).not.toHaveProperty('factories');
    expect(decimal?.signature).toBe('(private string $value)');
    expect(result?.text).toContain(`- BigDecimal → ${DECIMAL} (vía Money) — final: no se puede mockear; usa una instancia real con new — constructor(private string $value)`);
  });

  it('tokenCount de la sección no supera 500 y coincide con el texto', async () => {
    const { service } = makeRepository({ chunks: moneyChunks() });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.tokenCount).toBeGreaterThan(0);
    expect(result?.tokenCount).toBeLessThanOrEqual(500);
  });
});
