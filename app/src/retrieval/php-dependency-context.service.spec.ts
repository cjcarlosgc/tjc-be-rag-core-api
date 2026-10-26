import { describe, expect, it, vi } from 'vitest';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';

const NS = 'Pilot\\Subscriptions\\Services';
const DECLARING = `${NS}\\RenewalService`;
const CONTRACTS = 'Pilot\\Subscriptions\\Contracts';
const DOMAIN = 'Pilot\\Subscriptions\\Domain';
const FILE = 'src/Services/RenewalService.php';

const methodChunk = {
  filePath: FILE,
  symbolKind: 'METHOD',
  symbolName: `${DECLARING}::renew`,
  parentSymbolName: DECLARING,
  importsUsed: [`${DOMAIN}\\Subscription`],
  content: 'public function renew(Subscription $subscription): void {}',
};

function makeRepository(overrides: { files?: unknown[]; types?: string[]; error?: Error } = {}) {
  const findByFile = overrides.error
    ? vi.fn().mockRejectedValue(overrides.error)
    : vi.fn().mockResolvedValue(
        overrides.files ?? [
          {
            filePath: FILE,
            symbolKind: 'CLASS',
            symbolName: DECLARING,
            parentSymbolName: null,
            importsUsed: [`${CONTRACTS}\\PaymentGateway`, `${DOMAIN}\\Subscription`],
            content: 'class RenewalService {}',
          },
          {
            filePath: FILE,
            symbolKind: 'CONSTRUCTOR',
            symbolName: '__construct',
            parentSymbolName: DECLARING,
            importsUsed: [`${CONTRACTS}\\PaymentGateway`],
            content: 'public function __construct(private PaymentGateway $payments, private RenewalDatePolicy $dates) {}',
          },
        ],
      );
  const findPhpTypeSymbolNames = vi.fn().mockResolvedValue(overrides.types ?? [`${NS}\\RenewalDatePolicy`, `${DOMAIN}\\Subscription`]);
  const repository = { findByFile, findPhpTypeSymbolNames } as unknown as CodeChunksRepository;
  return { findByFile, findPhpTypeSymbolNames, service: new PhpDependencyContextService(repository) };
}

describe('PhpDependencyContextService.resolve', () => {
  it('devuelve entradas, texto y tokens para un método PHP', async () => {
    const { service, findByFile } = makeRepository();

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(findByFile).toHaveBeenCalledWith('version-1', FILE);
    expect(result).not.toBeNull();
    expect(result?.entries.map((entry) => [entry.typeName, entry.fqcn, entry.resolvedBy])).toEqual([
      ['PaymentGateway', `${CONTRACTS}\\PaymentGateway`, 'IMPORT'],
      ['RenewalDatePolicy', `${NS}\\RenewalDatePolicy`, 'SAME_NAMESPACE'],
      ['Subscription', `${DOMAIN}\\Subscription`, 'IMPORT'],
    ]);
    expect(result?.unresolvedCount).toBe(0);
    expect(result?.truncated).toBe(false);
    expect(result?.text).toContain(`- RenewalDatePolicy → ${NS}\\RenewalDatePolicy (constructor)`);
    expect(result?.tokenCount).toBeGreaterThan(0);
    expect(result?.tokenCount).toBeLessThanOrEqual(500);
  });

  it('usa los tipos conocidos del repositorio para decidir SAME_NAMESPACE', async () => {
    const { service } = makeRepository({ types: [] });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.entries.map((entry) => entry.typeName)).toEqual(['PaymentGateway', 'Subscription']);
    expect(result?.unresolvedCount).toBe(1);
  });

  it('devuelve null para TypeScript sin consultar el repositorio', async () => {
    const { service, findByFile, findPhpTypeSymbolNames } = makeRepository();

    const result = await service.resolve('version-1', [{ ...methodChunk, filePath: 'src/a.ts' }], 'typescript');

    expect(result).toBeNull();
    expect(findByFile).not.toHaveBeenCalled();
    expect(findPhpTypeSymbolNames).not.toHaveBeenCalled();
  });

  it('devuelve null si no hay chunk de método', async () => {
    const { service } = makeRepository();

    const result = await service.resolve('version-1', [{ ...methodChunk, symbolKind: 'CLASS' }], 'php');

    expect(result).toBeNull();
  });

  it('no propaga errores del repositorio y devuelve null con un warn', async () => {
    const { service } = makeRepository({ error: new TypeError('db down') });

    await expect(service.resolve('version-1', [methodChunk], 'php')).resolves.toBeNull();
  });
});

describe('PhpDependencyContextService final marks (WI-CORE-058)', () => {
  const POLICY = `${NS}\\RenewalDatePolicy`;
  const GATEWAY = `${CONTRACTS}\\PaymentGateway`;
  const REPOSITORY = `${CONTRACTS}\\SubscriptionRepository`;
  const finalFileChunks = [
    {
      filePath: FILE,
      symbolKind: 'CLASS',
      symbolName: DECLARING,
      parentSymbolName: null,
      importsUsed: [GATEWAY, `${CONTRACTS}\\SubscriptionRepository`, `${DOMAIN}\\Subscription`],
      content: 'class RenewalService {}',
    },
    {
      filePath: FILE,
      symbolKind: 'CONSTRUCTOR',
      symbolName: '__construct',
      parentSymbolName: DECLARING,
      importsUsed: [GATEWAY, REPOSITORY],
      content: 'public function __construct(private PaymentGateway $payments, private SubscriptionRepository $subscriptions, private RenewalDatePolicy $dates) {}',
    },
  ];
  const declarations = [
    { symbolName: POLICY, symbolKind: 'CLASS', content: '#[Policy]\nfinal class RenewalDatePolicy {}' },
    { symbolName: GATEWAY, symbolKind: 'INTERFACE', content: 'interface PaymentGateway {}' },
    { symbolName: REPOSITORY, symbolKind: 'INTERFACE', content: 'interface SubscriptionRepository {}' },
  ];

  function makeFinalRepository(options: { declarations?: unknown; declarationsError?: Error } = {}) {
    const findPhpTypeDeclarations = options.declarationsError
      ? vi.fn().mockRejectedValue(options.declarationsError)
      : vi.fn().mockResolvedValue(options.declarations ?? declarations);
    const repository = {
      findByFile: vi.fn().mockResolvedValue(finalFileChunks),
      findPhpTypeSymbolNames: vi.fn().mockResolvedValue([POLICY, GATEWAY, REPOSITORY, `${DOMAIN}\\Subscription`]),
      findPhpTypeDeclarations,
    } as unknown as CodeChunksRepository;
    return { findPhpTypeDeclarations, service: new PhpDependencyContextService(repository) };
  }

  it('marca como final solo el tipo final, sin marcar interfaces ni tipos fuera del índice', async () => {
    const { service, findPhpTypeDeclarations } = makeFinalRepository();

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(findPhpTypeDeclarations).toHaveBeenCalledWith('version-1', expect.arrayContaining([POLICY, GATEWAY, REPOSITORY]));
    const byFqcn = new Map(result?.entries.map((entry) => [entry.fqcn, entry]));
    expect(byFqcn.get(POLICY)?.final).toBe(true);
    expect(byFqcn.get(GATEWAY)).not.toHaveProperty('final');
    expect(byFqcn.get(REPOSITORY)).not.toHaveProperty('final');
    expect(result?.text).toContain(`- RenewalDatePolicy → ${POLICY} (constructor) — final: no se puede mockear`);
    expect(result?.text).not.toContain('- PaymentGateway → ' + GATEWAY + ' (constructor) —');
    expect(result?.tokenCount).toBeLessThanOrEqual(500);
  });

  it('no marca un tipo que no está en el índice de declaraciones', async () => {
    const { service } = makeFinalRepository({ declarations: [] });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.entries.some((entry) => 'final' in entry)).toBe(false);
    expect(result?.text).not.toContain('no se puede mockear');
  });

  it('si la consulta de declaraciones falla no afirma nada y mantiene las entradas', async () => {
    const { service } = makeFinalRepository({ declarationsError: new TypeError('db down') });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result).not.toBeNull();
    expect(result?.entries.length).toBeGreaterThan(0);
    expect(result?.entries.some((entry) => 'final' in entry)).toBe(false);
    expect(result?.text).not.toContain('no se puede mockear');
  });
});

describe('PhpDependencyContextService final lookups edge cases (WI-CORE-058)', () => {
  it('does not mark a non-final class that only contains a final method', async () => {
    const POLICY = `${NS}\\RenewalDatePolicy`;
    const repository = {
      findByFile: vi.fn().mockResolvedValue([
        {
          filePath: FILE,
          symbolKind: 'CLASS',
          symbolName: DECLARING,
          parentSymbolName: null,
          importsUsed: [`${DOMAIN}\\Subscription`],
          content: 'class RenewalService {}',
        },
        {
          filePath: FILE,
          symbolKind: 'CONSTRUCTOR',
          symbolName: '__construct',
          parentSymbolName: DECLARING,
          importsUsed: [],
          content: 'public function __construct(private RenewalDatePolicy $dates) {}',
        },
      ]),
      findPhpTypeSymbolNames: vi.fn().mockResolvedValue([POLICY]),
      findPhpTypeDeclarations: vi.fn().mockResolvedValue([
        {
          symbolName: POLICY,
          symbolKind: 'CLASS',
          content: 'class RenewalDatePolicy { final public function evaluate(): void {} }',
        },
      ]),
    } as unknown as CodeChunksRepository;
    const service = new PhpDependencyContextService(repository);

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const entry = result?.entries.find((item) => item.fqcn === POLICY);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('final');
    expect(result?.text).not.toContain('no se puede mockear');
  });

  it('sends at most 20 FQCN to the declarations query when more than 20 are resolved', async () => {
    const types = Array.from({ length: 25 }, (_, index) => `T${index}`);
    const imports = types.map((name) => `${DOMAIN}\\${name}`);
    const bigMethod = {
      ...methodChunk,
      importsUsed: imports,
      content: `public function renew(${types.map((name, index) => `${name} $a${index}`).join(', ')}): void {}`,
    };
    const findPhpTypeDeclarations = vi.fn().mockResolvedValue([]);
    const repository = {
      findByFile: vi.fn().mockResolvedValue([]),
      findPhpTypeSymbolNames: vi.fn().mockResolvedValue(imports),
      findPhpTypeDeclarations,
    } as unknown as CodeChunksRepository;
    const service = new PhpDependencyContextService(repository);

    await service.resolve('version-1', [bigMethod], 'php');

    expect(findPhpTypeDeclarations).toHaveBeenCalledTimes(1);
    const requested = findPhpTypeDeclarations.mock.calls[0][1] as string[];
    expect(requested).toHaveLength(20);
    expect(new Set(requested).size).toBe(20);
    for (const name of requested) expect(imports).toContain(name);
  });
});

describe('PhpDependencyContextService enum mark (WI-CORE-068)', () => {
  const STATUS = `${DOMAIN}\\SubscriptionStatus`;
  const enumRepository = () => {
    const files = [
      {
        filePath: FILE,
        symbolKind: 'CLASS',
        symbolName: DECLARING,
        parentSymbolName: null,
        importsUsed: [`${DOMAIN}\\Subscription`],
        content: 'class RenewalService {}',
      },
      {
        filePath: FILE,
        symbolKind: 'CONSTRUCTOR',
        symbolName: '__construct',
        parentSymbolName: DECLARING,
        importsUsed: [STATUS],
        content: 'public function __construct(private SubscriptionStatus $status) {}',
      },
    ];
    return {
      findByFile: vi.fn().mockResolvedValue(files),
      findPhpTypeSymbolNames: vi.fn().mockResolvedValue([STATUS, `${DOMAIN}\\Subscription`]),
      findPhpTypeDeclarations: vi.fn().mockResolvedValue([
        { symbolName: STATUS, symbolKind: 'ENUM', content: 'enum SubscriptionStatus: string { case Active = "a"; }' },
      ]),
    } as unknown as CodeChunksRepository;
  };

  it('un enum SubscriptionStatus renderiza la marca de enum y no la mención a new', async () => {
    const service = new PhpDependencyContextService(enumRepository());

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.text).toContain(
      `- SubscriptionStatus → ${STATUS} (constructor) — enum: no se puede mockear ni instanciar con new; usa un caso (Enum::Caso)`,
    );
    expect(result?.text).not.toContain('new, o un caso');
    expect(result?.entries[0].final).toBe(true);
    expect(result?.tokenCount).toBeLessThanOrEqual(500);
  });
});
