import { describe, expect, it, vi } from 'vitest';
import {
  applyDependencyTokenCap,
  MAX_PHP_DEPENDENCY_ENTRIES,
  renderPhpDependencySection,
  resolvePhpConstructorTypes,
  type PhpDependencyEntry,
} from './php-dependency-context.js';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';
import { Logger } from '@nestjs/common';
import { PHP_PROMPT_CONVENTIONS_VERSION } from '../generation/php-phpunit-conventions.js';

const NS = 'Pilot\\Subscriptions\\Services';
const DECLARING = `${NS}\\RenewalService`;
const DOMAIN = 'Pilot\\Subscriptions\\Domain';
const SUBSCRIPTION = `${DOMAIN}\\Subscription`;
const PLAN = `${DOMAIN}\\Plan`;
const FILE = 'src/Services/RenewalService.php';

describe('resolvePhpConstructorTypes (WI-CORE-066)', () => {
  it('resuelve literal, import y mismo namespace (solo si existe en el índice); omite escalares, globales e inventados', () => {
    const resolved = resolvePhpConstructorTypes({
      declaringClass: 'Ns\\Box',
      content:
        'public function __construct(private \\Vendor\\Pkg\\Thing $t, private Money $m, private Inner $i, private int $n, private \\DateTimeImmutable $d, private Unknown $u) {}',
      importsUsed: ['Vendor\\Money'],
      knownTypes: new Set(['Ns\\Inner']),
    });

    expect(resolved).toEqual([
      { typeName: 'Thing', fqcn: 'Vendor\\Pkg\\Thing', resolvedBy: 'LITERAL' },
      { typeName: 'Money', fqcn: 'Vendor\\Money', resolvedBy: 'IMPORT' },
      { typeName: 'Inner', fqcn: 'Ns\\Inner', resolvedBy: 'SAME_NAMESPACE' },
    ]);
  });

  it('deduplica por FQCN y nunca lanza con contenido vacío o basura', () => {
    expect(
      resolvePhpConstructorTypes({
        declaringClass: 'Ns\\Box',
        content: 'public function __construct(Money $a, Money $b) {}',
        importsUsed: ['Vendor\\Money'],
        knownTypes: new Set(),
      }),
    ).toHaveLength(1);
    expect(() =>
      resolvePhpConstructorTypes({ declaringClass: 'Ns\\Box', content: '', importsUsed: [], knownTypes: new Set() }),
    ).not.toThrow();
    expect(
      resolvePhpConstructorTypes({ declaringClass: 'Ns\\Box', content: '}{ basura (((', importsUsed: [], knownTypes: new Set() }),
    ).toEqual([]);
  });
});

describe('renderPhpDependencySection con profundidad 2 (WI-CORE-066)', () => {
  it('escribe la entrada de profundidad 2 con «(vía X)» y la firma', () => {
    const entry: PhpDependencyEntry = {
      typeName: 'Plan',
      fqcn: PLAN,
      origin: 'CONSTRUCTOR',
      resolvedBy: 'IMPORT',
      via: 'Subscription',
      signature: '(public string $code, public float $monthlyPrice)',
    };

    expect(renderPhpDependencySection([entry]).split('\n').at(-1)).toBe(
      `- Plan → ${PLAN} (vía Subscription) — constructor(public string $code, public float $monthlyPrice)`,
    );
  });

  it('mantiene la marca final en las entradas de profundidad 2', () => {
    const text = renderPhpDependencySection([
      { typeName: 'Plan', fqcn: PLAN, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT', final: true, via: 'Subscription', signature: '()' },
    ]);
    expect(text.split('\n').at(-1)).toMatch(/^- Plan → .* \(vía Subscription\) — final: no se puede mockear/);
  });
});

describe('applyDependencyTokenCap con profundidad 2 (WI-CORE-066)', () => {
  it('retira primero las entradas de profundidad 2 y conserva las firmas de las directas', () => {
    const longSignature = `(${Array.from({ length: 60 }, (_, i) => `public string $param${i}`).join(', ')})`;
    const entries: PhpDependencyEntry[] = [
      { typeName: 'Subscription', fqcn: SUBSCRIPTION, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT', signature: '(private Plan $plan)' },
      { typeName: 'Deep', fqcn: `${DOMAIN}\\Deep`, origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT', via: 'Subscription', signature: longSignature },
    ];

    const capped = applyDependencyTokenCap(entries, 300);

    expect(capped.entries.map((entry) => entry.typeName)).toEqual(['Subscription']);
    expect(capped.entries[0].signature).toBe('(private Plan $plan)');
    expect(capped.truncated).toBe(true);
    expect(capped.tokenCount).toBeLessThanOrEqual(300);
  });
});

interface Chunk {
  filePath: string;
  symbolKind: string;
  symbolName: string;
  parentSymbolName: string | null;
  importsUsed: string[];
  content: string;
}

function methodChunk(): Chunk {
  return {
    filePath: FILE,
    symbolKind: 'METHOD',
    symbolName: `${DECLARING}::renew`,
    parentSymbolName: DECLARING,
    importsUsed: [SUBSCRIPTION],
    content: 'public function renew(Subscription $subscription): void {}',
  };
}

/**
 * Repositorio falso con la misma semántica del real: declaraciones por símbolo (CLASS/INTERFACE/ENUM/TRAIT),
 * constructores de partes 1 por padre, sin ambigüedad. `typeErrorFromCall` hace fallar la consulta de tipos
 * a partir de esa llamada (1-based) para probar la best-effort.
 */
function makeRepository(options: {
  chunks: Chunk[];
  knownTypes?: string[];
  typeErrorFromCall?: number;
  constructorLookupsSeen?: string[][];
}) {
  const fileChunks = [
    ...options.chunks,
    {
      filePath: FILE,
      symbolKind: 'CLASS',
      symbolName: DECLARING,
      parentSymbolName: null,
      importsUsed: [SUBSCRIPTION],
      content: 'class RenewalService {}',
    },
    {
      filePath: FILE,
      symbolKind: 'CONSTRUCTOR',
      symbolName: '__construct',
      parentSymbolName: DECLARING,
      importsUsed: [SUBSCRIPTION],
      content: 'public function __construct(private Subscription $subscription) {}',
    },
  ];
  const all = [...fileChunks, methodChunk()];
  let typeCalls = 0;
  const repository = {
    findByFile: vi.fn().mockImplementation(async (_pv: string, filePath: string) => fileChunks.filter((c) => c.filePath === filePath)),
    findPhpTypeSymbolNames: vi.fn().mockResolvedValue(
      options.knownTypes ?? [...options.chunks.filter((c) => c.symbolKind !== 'CONSTRUCTOR' && c.symbolKind !== 'METHOD').map((c) => c.symbolName), DECLARING],
    ),
    findPhpTypeDeclarations: vi.fn().mockImplementation(async (_pv: string, names: string[]) => {
      typeCalls += 1;
      if (options.typeErrorFromCall === typeCalls) throw new Error('connection refused: secreto-interno');
      return options.chunks
        .filter((c) => names.includes(c.symbolName) && ['CLASS', 'INTERFACE', 'ENUM', 'TRAIT'].includes(c.symbolKind))
        .map((c) => ({ symbolName: c.symbolName, symbolKind: c.symbolKind, content: c.content }));
    }),
    findPhpConstructorDeclarations: vi.fn().mockImplementation(async (_pv: string, parents: string[]) => {
      options.constructorLookupsSeen?.push(parents);
      return all
        .filter((c) => c.symbolKind === 'CONSTRUCTOR' && c.parentSymbolName !== null && parents.includes(c.parentSymbolName))
        .map((c) => ({ parentSymbolName: c.parentSymbolName as string, content: c.content, importsUsed: c.importsUsed }));
    }),
  } as unknown as CodeChunksRepository;
  return { repository, service: new PhpDependencyContextService(repository) };
}

const subscriptionChunks = (): Chunk[] => [
  {
    filePath: 'src/Domain/Subscription.php',
    symbolKind: 'CLASS',
    symbolName: SUBSCRIPTION,
    parentSymbolName: null,
    importsUsed: [PLAN],
    content: 'class Subscription {}',
  },
  {
    filePath: 'src/Domain/Subscription.php',
    symbolKind: 'CONSTRUCTOR',
    symbolName: '__construct',
    parentSymbolName: SUBSCRIPTION,
    importsUsed: [PLAN],
    content: 'public function __construct(private Plan $plan) {}',
  },
  {
    filePath: 'src/Domain/Plan.php',
    symbolKind: 'CLASS',
    symbolName: PLAN,
    parentSymbolName: null,
    importsUsed: [],
    content: 'class Plan {}',
  },
  {
    filePath: 'src/Domain/Plan.php',
    symbolKind: 'CONSTRUCTOR',
    symbolName: '__construct',
    parentSymbolName: PLAN,
    importsUsed: [],
    content: 'public function __construct(public string $code, public float $monthlyPrice) {}',
  },
];

describe('PhpDependencyContextService profundidad 2 (WI-CORE-066)', () => {
  it('añade la firma de Plan vía Subscription (SUB-1/SUB-2) en el texto y la deja fuera de entries', async () => {
    const { service } = makeRepository({
      chunks: subscriptionChunks(),
      knownTypes: [SUBSCRIPTION, PLAN, DECLARING],
    });
    // Subscription entra como directa vía importación en el método y en el constructor.
    const result = await service.resolve('version-1', [methodChunk() as never], 'php');

    expect(result?.entries.map((entry) => entry.typeName)).toEqual(['Subscription']);
    expect(result?.entries.every((entry) => entry.via === undefined)).toBe(true);
    expect(result?.transitiveEntries?.map((entry) => [entry.typeName, entry.via, entry.origin, entry.resolvedBy])).toEqual([
      ['Plan', 'Subscription', 'CONSTRUCTOR', 'IMPORT'],
    ]);
    expect(result?.text).toContain(
      `- Plan → ${PLAN} (vía Subscription) — constructor(public string $code, public float $monthlyPrice)`,
    );
    expect(result?.text.indexOf('- Subscription →')).toBeLessThan(result?.text.indexOf('- Plan →') ?? -1);
    expect(result?.tokenCount).toBeLessThanOrEqual(300);
  });

  it('no incluye tipos de profundidad 2 que son interfaz, enum o trait según el índice', async () => {
    for (const kind of ['INTERFACE', 'ENUM', 'TRAIT']) {
      const chunks = subscriptionChunks().map((c) => (c.symbolName === PLAN && c.symbolKind === 'CLASS' ? { ...c, symbolKind: kind } : c));
      const { service } = makeRepository({ chunks, knownTypes: [SUBSCRIPTION, PLAN, DECLARING] });
      const result = await service.resolve('version-1', [methodChunk() as never], 'php');
      expect(result?.transitiveEntries ?? [], kind).toEqual([]);
      expect(result?.text).not.toContain('(vía Subscription)');
    }
  });

  it('solo añade tipos de profundidad 2 que tienen firma (clase concreta con constructor)', async () => {
    const chunks = subscriptionChunks().filter((c) => !(c.parentSymbolName === PLAN && c.symbolKind === 'CONSTRUCTOR'));
    const { service } = makeRepository({ chunks, knownTypes: [SUBSCRIPTION, PLAN, DECLARING] });
    const result = await service.resolve('version-1', [methodChunk() as never], 'php');
    expect(result?.transitiveEntries ?? []).toEqual([]);
  });

  it('deduplica y corta ciclos: A→B→A no repite A ni la incluye como profundidad 2', async () => {
    const chunks: Chunk[] = [
      ...subscriptionChunks().filter((c) => c.symbolKind !== 'CONSTRUCTOR'),
      {
        filePath: 'src/Domain/Subscription.php',
        symbolKind: 'CONSTRUCTOR',
        symbolName: '__construct',
        parentSymbolName: SUBSCRIPTION,
        importsUsed: [PLAN, DECLARING],
        content: 'public function __construct(private Plan $plan, private RenewalService $back) {}',
      },
      {
        filePath: 'src/Domain/Plan.php',
        symbolKind: 'CONSTRUCTOR',
        symbolName: '__construct',
        parentSymbolName: PLAN,
        importsUsed: [SUBSCRIPTION],
        content: 'public function __construct(private Subscription $back) {}',
      },
    ];
    const { service } = makeRepository({ chunks, knownTypes: [SUBSCRIPTION, PLAN, DECLARING] });
    const result = await service.resolve('version-1', [methodChunk() as never], 'php');

    const fqcns = [...(result?.entries ?? []), ...(result?.transitiveEntries ?? [])].map((entry) => entry.fqcn);
    expect(new Set(fqcns).size).toBe(fqcns.length);
    expect(fqcns).not.toContain(DECLARING);
    // Plan aparece una sola vez, como profundidad 2 vía Subscription; su referencia de vuelta a Subscription no se repite.
    expect(result?.transitiveEntries?.map((entry) => [entry.typeName, entry.via])).toEqual([['Plan', 'Subscription']]);
  });

  it('respeta el límite de 20 entradas entre directas y profundidad 2 y consulta como máximo 20 nombres', async () => {
    const hubDeps = Array.from({ length: 10 }, (_, i) => `${DOMAIN}\\T${String(i).padStart(2, '0')}`);
    const HUB = `${DOMAIN}\\Hub`;
    const plainDirects = Array.from({ length: 14 }, (_, i) => `${NS}\\D${String(i).padStart(2, '0')}`);
    const chunks: Chunk[] = [
      {
        filePath: 'src/Domain/Hub.php',
        symbolKind: 'CLASS',
        symbolName: HUB,
        parentSymbolName: null,
        importsUsed: hubDeps,
        content: 'class Hub {}',
      },
      {
        filePath: 'src/Domain/Hub.php',
        symbolKind: 'CONSTRUCTOR',
        symbolName: '__construct',
        parentSymbolName: HUB,
        importsUsed: hubDeps,
        content: `public function __construct(${hubDeps.map((d, i) => `private ${d.split('\\').at(-1)} $t${i}`).join(', ')}) {}`,
      },
      ...[...hubDeps, ...plainDirects].flatMap((fqcn) => [
        {
          filePath: `src/Types/${fqcn.split('\\').at(-1)}.php`,
          symbolKind: 'CLASS',
          symbolName: fqcn,
          parentSymbolName: null,
          importsUsed: [],
          content: `class ${fqcn.split('\\').at(-1)} {}`,
        },
        {
          filePath: `src/Types/${fqcn.split('\\').at(-1)}.php`,
          symbolKind: 'CONSTRUCTOR',
          symbolName: '__construct',
          parentSymbolName: fqcn,
          importsUsed: [],
          content: 'public function __construct(int $x) {}',
        },
      ]),
    ];
    const lookups: string[][] = [];
    const { service, repository } = makeRepository({
      chunks,
      knownTypes: [DECLARING, HUB, ...hubDeps, ...plainDirects],
      constructorLookupsSeen: lookups,
    });
    const declaringMethod = {
      ...methodChunk(),
      importsUsed: [HUB, ...plainDirects],
      content: `public function renew(Hub $hub, ${plainDirects.map((_, i) => `D${String(i).padStart(2, '0')} $d${i}`).join(', ')}): void {}`,
    };

    const result = await service.resolve('version-1', [declaringMethod as never], 'php');

    // 16 directas (15 del método + Subscription del constructor del declarante): quedan 4 huecos de profundidad 2.
    const total = (result?.entries.length ?? 0) + (result?.transitiveEntries?.length ?? 0);
    expect(result?.entries.length).toBe(16);
    expect(total).toBeLessThanOrEqual(MAX_PHP_DEPENDENCY_ENTRIES);
    expect(result?.truncated).toBe(true);
    const typeLookups = vi.mocked(repository.findPhpTypeDeclarations).mock.calls.map((call) => (call[1] as string[]).length);
    // La primera consulta son las 16 directas; la de profundidad 2 pide solo los huecos disponibles (4).
    expect(typeLookups[0]).toBe(16);
    expect(typeLookups.at(-1)).toBe(MAX_PHP_DEPENDENCY_ENTRIES - 16);
    for (const parents of lookups) expect(parents.length).toBeLessThanOrEqual(MAX_PHP_DEPENDENCY_ENTRIES);
  });

  it('si la consulta de declaraciones de profundidad 2 falla, omite esa profundidad, avisa sin el mensaje y conserva las directas', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeRepository({
      chunks: subscriptionChunks(),
      knownTypes: [SUBSCRIPTION, PLAN, DECLARING],
      typeErrorFromCall: 2,
    });

    const result = await service.resolve('version-1', [methodChunk() as never], 'php');

    expect(result?.entries.map((entry) => entry.typeName)).toEqual(['Subscription']);
    expect(result?.transitiveEntries ?? []).toEqual([]);
    expect(result?.text).not.toContain('(vía');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Error'));
    expect(warn.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('secreto-interno');
    warn.mockRestore();
  });

  it('la traza (entries) no cambia de forma: solo directas, sin claves via ni transitive', async () => {
    const { service } = makeRepository({
      chunks: subscriptionChunks(),
      knownTypes: [SUBSCRIPTION, PLAN, DECLARING],
    });
    const result = await service.resolve('version-1', [methodChunk() as never], 'php');

    expect(Object.keys(result?.entries[0] ?? {}).sort()).toEqual(['fqcn', 'origin', 'resolvedBy', 'signature', 'typeName'].sort());
  });
});

describe('versión del prompt (WI-CORE-066)', () => {
  it('declara php-prompt-2026-10-14.6', () => {
    expect(PHP_PROMPT_CONVENTIONS_VERSION).toBe('php-prompt-2026-10-14.6');
  });
});
