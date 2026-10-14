import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';

const NS = 'Pilot\\Subscriptions\\Services';
const DECLARING = `${NS}\\RenewalService`;
const DOMAIN = 'Pilot\\Subscriptions\\Domain';
const FILE = 'src/Services/RenewalService.php';
const PLAN = `${DOMAIN}\\Plan`;
const POLICY = `${NS}\\RenewalDatePolicy`;
const GATEWAY = 'Pilot\\Subscriptions\\Contracts\\PaymentGateway';
const MODE = `${DOMAIN}\\Mode`;

const methodChunk = {
  filePath: FILE,
  symbolKind: 'METHOD',
  symbolName: `${DECLARING}::renew`,
  parentSymbolName: DECLARING,
  importsUsed: [PLAN, GATEWAY, MODE],
  content: `public function renew(Plan $plan, PaymentGateway $gateway, Mode $mode): void {}`,
};

const fileChunks = [
  {
    filePath: FILE,
    symbolKind: 'CLASS',
    symbolName: DECLARING,
    parentSymbolName: null,
    importsUsed: [PLAN, GATEWAY, MODE],
    content: 'class RenewalService {}',
  },
  {
    filePath: FILE,
    symbolKind: 'CONSTRUCTOR',
    symbolName: '__construct',
    parentSymbolName: DECLARING,
    importsUsed: [],
    content: `public function __construct(private ${POLICY.split('\\').at(-1)} $dates) {}`,
  },
];

function makeService(options: {
  constructors?: Array<{ parentSymbolName: string; content: string }>;
  constructorsError?: Error;
  declarations?: Array<{ symbolName: string; symbolKind: string; content: string }>;
  types?: string[];
}) {
  const findPhpConstructorDeclarations = options.constructorsError
    ? vi.fn().mockRejectedValue(options.constructorsError)
    : vi.fn().mockResolvedValue(options.constructors ?? []);
  const repository = {
    findByFile: vi.fn().mockResolvedValue([
      ...fileChunks,
    ]),
    findPhpTypeSymbolNames: vi.fn().mockResolvedValue(options.types ?? [PLAN, POLICY, GATEWAY, MODE]),
    findPhpTypeDeclarations: vi.fn().mockResolvedValue(options.declarations ?? []),
    findPhpConstructorDeclarations,
  } as unknown as CodeChunksRepository;
  return { findPhpConstructorDeclarations, service: new PhpDependencyContextService(repository) };
}

describe('PhpDependencyContextService constructor signatures (WI-CORE-065)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no añade firma a un tipo sin constructor y sí a un tipo con constructor promovido', async () => {
    const { service, findPhpConstructorDeclarations } = makeService({
      constructors: [
        {
          parentSymbolName: PLAN,
          content: 'public function __construct(public string $code, public float $monthlyPrice) {}',
        },
      ],
    });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const requested = findPhpConstructorDeclarations.mock.calls[0]?.[1] as string[];
    expect(requested).toEqual(expect.arrayContaining([PLAN, POLICY]));
    const byFqcn = new Map(result?.entries.map((entry) => [entry.fqcn, entry]));
    expect(byFqcn.get(PLAN)?.signature).toBe('(public string $code, public float $monthlyPrice)');
    expect(byFqcn.get(POLICY)).not.toHaveProperty('signature');
    expect(result?.text).toContain('— constructor(public string $code, public float $monthlyPrice)');
  });

  it('un FQCN que el repositorio omite por ambiguo queda sin firma', async () => {
    const { service } = makeService({ constructors: [] });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.entries.some((entry) => 'signature' in entry)).toBe(false);
    expect(result?.text).not.toContain('— constructor(');
  });

  it('no pide ni firma interfaces ni enums según el índice de declaraciones', async () => {
    const { service, findPhpConstructorDeclarations } = makeService({
      constructors: [
        { parentSymbolName: GATEWAY, content: 'public function __construct(string $x) {}' },
        { parentSymbolName: MODE, content: 'public function __construct(string $y) {}' },
      ],
      declarations: [
        { symbolName: GATEWAY, symbolKind: 'INTERFACE', content: 'interface PaymentGateway {}' },
        { symbolName: MODE, symbolKind: 'ENUM', content: 'enum Mode {}' },
      ],
    });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    const requested = (findPhpConstructorDeclarations.mock.calls[0]?.[1] ?? []) as string[];
    expect(requested).not.toContain(GATEWAY);
    expect(requested).not.toContain(MODE);
    for (const entry of result?.entries ?? []) {
      if (entry.fqcn === GATEWAY || entry.fqcn === MODE) expect(entry).not.toHaveProperty('signature');
    }
  });

  it('si la consulta de constructores falla no propaga, mantiene las entradas y avisa sin el mensaje de error', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeService({ constructorsError: new TypeError('secret db detail') });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result).not.toBeNull();
    expect(result?.entries.length).toBeGreaterThan(0);
    expect(result?.entries.some((entry) => 'signature' in entry)).toBe(false);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain('secret db detail');
  });
});
