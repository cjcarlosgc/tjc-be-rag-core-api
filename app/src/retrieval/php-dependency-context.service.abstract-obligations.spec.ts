import { describe, expect, it, vi } from 'vitest';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import { PhpDeclarationQueryLimitError, type CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';

const NS = 'Acme\\Mapping';
const OBLIGATIONS_HEADER = 'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos):';

interface FakeType {
  kind: 'CLASS' | 'INTERFACE' | 'TRAIT' | 'ENUM';
  /** Partes del chunk de tipo (la primera lleva la cabecera). */
  parts: string[];
  imports?: string[];
  /** Contenido de los chunks METHOD/CONSTRUCTOR (solo clases). */
  methods?: string[];
}

interface FakeFileChunk {
  symbolKind: string;
  symbolName: string;
  parentSymbolName: string | null;
  importsUsed: string[];
  content: string;
}

interface Scenario {
  declaring: string;
  file: FakeFileChunk[];
  types: Record<string, FakeType>;
  /** Tipos que el índice conoce pero cuyo chunk no devuelve la consulta de partes (p. ej. ambiguos). */
  extraKnownTypes?: string[];
}

const FILE = 'src/Mapping/Declaring.php';

function classChunk(name: string, content: string, importsUsed: string[] = []): FakeFileChunk {
  return { symbolKind: 'CLASS', symbolName: name, parentSymbolName: null, importsUsed, content };
}

function methodChunk(parent: string, content: string, importsUsed: string[] = []): FakeFileChunk {
  const name = /function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(content)?.[1] ?? 'unknown';
  return { symbolKind: name === '__construct' ? 'CONSTRUCTOR' : 'METHOD', symbolName: `${parent}::${name}`, parentSymbolName: parent, importsUsed, content };
}

function makeRepository(scenario: Scenario, overrides: Partial<Record<'parts' | 'methods', Error>> = {}) {
  const partsCalls: string[][] = [];
  const methodCalls: string[][] = [];
  const findPhpTypeDeclarationParts = overrides.parts
    ? vi.fn().mockRejectedValue(overrides.parts)
    : vi.fn(async (_version: string, names: string[]) => {
        partsCalls.push([...names]);
        return names.flatMap((name) => {
          const type = scenario.types[name];
          if (!type) return [];
          return type.parts.map((content, index) => ({
            symbolName: name,
            symbolKind: type.kind,
            partIndex: index + 1,
            content,
            importsUsed: type.imports ?? [],
          }));
        });
      });
  const findPhpMethodDeclarations = overrides.methods
    ? vi.fn().mockRejectedValue(overrides.methods)
    : vi.fn(async (_version: string, owners: string[]) => {
        methodCalls.push([...owners]);
        return owners.flatMap((owner) =>
          (scenario.types[owner]?.methods ?? []).map((content) => ({ parentSymbolName: owner, symbolName: null, content })),
        );
      });
  const repository = {
    findByFile: vi.fn().mockResolvedValue(scenario.file),
    findPhpTypeSymbolNames: vi.fn().mockResolvedValue([...Object.keys(scenario.types), scenario.declaring, ...(scenario.extraKnownTypes ?? [])]),
    findPhpTypeDeclarations: vi.fn(async (_version: string, names: string[]) =>
      names.flatMap((name) => {
        const type = scenario.types[name];
        return type ? [{ symbolName: name, symbolKind: type.kind, content: type.parts[0] }] : [];
      }),
    ),
    findPhpConstructorDeclarations: vi.fn().mockResolvedValue([]),
    findPhpStaticMethodDeclarations: vi.fn().mockResolvedValue([]),
    findPhpTypeDeclarationParts,
    findPhpMethodDeclarations,
  } as unknown as CodeChunksRepository;
  return { repository, service: new PhpDependencyContextService(repository), partsCalls, methodCalls, findPhpTypeDeclarationParts, findPhpMethodDeclarations };
}

function targetFor(scenario: Scenario, content = 'public function getCachedNames(): array { return []; }') {
  return {
    filePath: FILE,
    symbolKind: 'METHOD',
    symbolName: `${scenario.declaring}::getCachedNames`,
    parentSymbolName: scenario.declaring,
    importsUsed: [],
    content,
  };
}

const DRIVER = `${NS}\\MappingDriver`;
const FILE_DRIVER = `${NS}\\FileDriver`;

// Escenario S1 genérico: clase abstracta que implementa una interfaz y deja un método heredado sin definir.
function fileDriverScenario(): Scenario {
  const declaringClass = `abstract class FileDriver implements MappingDriver
{
    public function __construct(protected FileLocator $locator) {}

    /** Devuelve los nombres. */
    public function getAllClassNames(): array { return []; }

    public function isTransient(string $className): bool { return false; }

    abstract protected function loadMappingFile(string $file): array;

    public function getCachedNames(): array { return []; }
}`;
  return {
    declaring: FILE_DRIVER,
    file: [
      classChunk(FILE_DRIVER, `<?php\nnamespace ${NS};\n\n${declaringClass}`, []),
      methodChunk(FILE_DRIVER, 'public function __construct(protected FileLocator $locator) {}'),
      methodChunk(FILE_DRIVER, 'public function getAllClassNames(): array { return []; }'),
      methodChunk(FILE_DRIVER, 'public function isTransient(string $className): bool { return false; }'),
      methodChunk(FILE_DRIVER, 'abstract protected function loadMappingFile(string $file): array;'),
      methodChunk(FILE_DRIVER, 'public function getCachedNames(): array { return []; }'),
    ],
    types: {
      [DRIVER]: {
        kind: 'INTERFACE',
        parts: [
          `interface MappingDriver
{
    public function loadMetadataForClass(string $className, ClassMetadata $metadata): void;

    public function getAllClassNames(): array;

    public function isTransient(string $className): bool;
}`,
        ],
      },
      [`${NS}\\FileLocator`]: { kind: 'INTERFACE', parts: ['interface FileLocator { public function find(string $name): ?string; }'] },
    },
  };
}

describe('PhpDependencyContextService: obligaciones abstractas heredadas (WI-CORE-106)', () => {
  it('escenario S1: FileDriver abstracta implements MappingDriver lista lo heredado y lo propio, no lo ya implementado', async () => {
    const scenario = fileDriverScenario();
    const { service, partsCalls } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual([
      'FileDriver::loadMappingFile(string $file): array',
      'MappingDriver::loadMetadataForClass(string $className, ClassMetadata $metadata): void',
    ]);
    expect(result?.text).toContain(
      `${OBLIGATIONS_HEADER}\n- FileDriver::loadMappingFile(string $file): array\n- MappingDriver::loadMetadataForClass(string $className, ClassMetadata $metadata): void`,
    );
    expect(result?.text).not.toContain('getAllClassNames');
    expect(result?.text).not.toContain('isTransient');
    // Las dependencias existentes siguen allí y antes del bloque.
    expect(result?.entries.map((entry) => entry.fqcn)).toEqual([`${NS}\\FileLocator`]);
    expect(result?.text.indexOf('Dependencias del código objetivo')).toBeLessThan(result?.text.indexOf(OBLIGATIONS_HEADER) ?? -1);
    expect(result?.truncated).toBe(false);
    expect(result?.tokenCount).toBeGreaterThan(0);
    expect(result?.tokenCount).toBeLessThanOrEqual(500);
    expect(partsCalls[0]).toEqual([DRIVER]);
  });

  it('sin entradas de dependencia devuelve la sección solo con obligaciones (entries: [])', async () => {
    const scenario = fileDriverScenario();
    scenario.file = scenario.file.filter((chunk) => chunk.symbolKind !== 'CONSTRUCTOR');
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result).not.toBeNull();
    expect(result?.entries).toEqual([]);
    expect(result?.transitiveEntries).toEqual([]);
    expect(result?.unresolvedCount).toBe(0);
    expect(result?.text.startsWith(OBLIGATIONS_HEADER)).toBe(true);
    expect(result?.tokenCount).toBeGreaterThan(0);
  });

  it('clase abstracta sin abstractos propios ni heredados mantiene el comportamiento anterior (null sin entradas)', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Plain`,
      file: [classChunk(`${NS}\\Plain`, 'abstract class Plain { public function run(): void {} }'), methodChunk(`${NS}\\Plain`, 'public function run(): void {}')],
      types: {},
    };
    const { service } = makeRepository(scenario);

    await expect(service.resolve('version-1', [targetFor(scenario)], 'php')).resolves.toBeNull();
  });

  it('recorre padres e interfaces hasta profundidad 3 y no consulta el nivel 4', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Top`,
      file: [classChunk(`${NS}\\Top`, 'abstract class Top implements Level1 { }'), methodChunk(`${NS}\\Top`, 'public function x(): void {}')],
      types: {
        [`${NS}\\Level1`]: { kind: 'INTERFACE', parts: ['interface Level1 extends Level2 { public function one(): int; }'] },
        [`${NS}\\Level2`]: { kind: 'INTERFACE', parts: ['interface Level2 extends Level3 { public function two(): int; }'] },
        [`${NS}\\Level3`]: { kind: 'INTERFACE', parts: ['interface Level3 extends Level4 { public function three(): int; }'] },
        [`${NS}\\Level4`]: { kind: 'INTERFACE', parts: ['interface Level4 { public function four(): int; }'] },
      },
    };
    const { service, partsCalls } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Level1::one(): int', 'Level2::two(): int', 'Level3::three(): int']);
    expect(partsCalls).toEqual([[`${NS}\\Level1`], [`${NS}\\Level2`], [`${NS}\\Level3`]]);
  });

  it('resta lo que un padre abstracto implementa con cuerpo y conserva sus propios abstractos', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [classChunk(`${NS}\\Leaf`, 'abstract class Leaf extends Base { }'), methodChunk(`${NS}\\Leaf`, 'public function x(): void {}')],
      types: {
        [`${NS}\\Base`]: {
          kind: 'CLASS',
          parts: ['abstract class Base implements Contract { }'],
          methods: [
            'public function run(): void { }',
            'abstract protected function hook(array $options = []): ?string;',
            'public function __construct(private int $size) {}',
          ],
        },
        [`${NS}\\Contract`]: {
          kind: 'INTERFACE',
          parts: ['interface Contract { public function run(): void; public function stop(bool $force = false): void; }'],
        },
      },
    };
    const { service, methodCalls } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual([
      'Base::hook(array $options = []): ?string',
      'Contract::stop(bool $force = false): void',
    ]);
    expect(methodCalls).toEqual([[`${NS}\\Base`]]);
  });

  it('una redeclaración abstracta del declarante gana sobre la implementación del padre', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [
        classChunk(`${NS}\\Leaf`, 'abstract class Leaf extends Base { }'),
        methodChunk(`${NS}\\Leaf`, 'abstract public function run(): void;'),
        methodChunk(`${NS}\\Leaf`, 'public function other(): void {}'),
      ],
      types: { [`${NS}\\Base`]: { kind: 'CLASS', parts: ['class Base { }'], methods: ['public function run(): void { }'] } },
    };
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Leaf::run(): void']);
  });

  it('un ciclo A extends B extends A termina sin repetir consultas', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Alpha`,
      file: [classChunk(`${NS}\\Alpha`, 'abstract class Alpha extends Beta { }'), methodChunk(`${NS}\\Alpha`, 'abstract protected function a(): void;')],
      types: {
        [`${NS}\\Beta`]: { kind: 'CLASS', parts: ['abstract class Beta extends Alpha implements Gamma { }'], methods: ['abstract protected function b(): void;'] },
        [`${NS}\\Gamma`]: { kind: 'INTERFACE', parts: ['interface Gamma extends Gamma { public function g(): void; }'] },
      },
    };
    const { service, partsCalls } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Alpha::a(): void', 'Beta::b(): void', 'Gamma::g(): void']);
    const requested = partsCalls.flat();
    expect(requested).toEqual([`${NS}\\Beta`, `${NS}\\Gamma`]);
    expect(new Set(requested).size).toBe(requested.length);
  });

  it('ignora tipos fuera del índice, globales de PHP, traits y enums sin inventar nada', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [
        classChunk(
          `${NS}\\Leaf`,
          'abstract class Leaf extends \\Vendor\\Lib\\External implements \\Countable, Phantom, Known, Mixin, Flags { }',
        ),
        methodChunk(`${NS}\\Leaf`, 'public function x(): void {}'),
      ],
      types: {
        [`${NS}\\Known`]: { kind: 'INTERFACE', parts: ['interface Known { public function known(): void; }'] },
        [`${NS}\\Mixin`]: { kind: 'TRAIT', parts: ['trait Mixin { abstract public function fromTrait(): void; }'] },
        [`${NS}\\Flags`]: { kind: 'ENUM', parts: ['enum Flags implements Known { case A; }'] },
      },
    };
    const { service, partsCalls } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Known::known(): void']);
    // Phantom (mismo namespace, no está en el índice) y \Countable (global) no se consultan; el literal \Vendor\… sí
    // pero no produce nada porque el índice no lo tiene.
    expect(partsCalls[0]).toEqual(['Vendor\\Lib\\External', `${NS}\\Known`, `${NS}\\Mixin`, `${NS}\\Flags`]);
    expect(result?.text).not.toContain('fromTrait');
  });

  it('no emite nada con clase declarante concreta, final o cabecera ilegible y no consulta la jerarquía', async () => {
    for (const header of ['class Leaf extends Base implements Contract { }', 'final class Leaf implements Contract { }', 'abstract class Leaf extends { ']) {
      const scenario: Scenario = {
        declaring: `${NS}\\Leaf`,
        file: [classChunk(`${NS}\\Leaf`, header), methodChunk(`${NS}\\Leaf`, 'public function x(): void {}')],
        types: {
          [`${NS}\\Base`]: { kind: 'CLASS', parts: ['abstract class Base { }'], methods: ['abstract public function hook(): void;'] },
          [`${NS}\\Contract`]: { kind: 'INTERFACE', parts: ['interface Contract { public function run(): void; }'] },
        },
      };
      const { service, findPhpTypeDeclarationParts, findPhpMethodDeclarations } = makeRepository(scenario);

      const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

      expect(result).toBeNull();
      expect(findPhpTypeDeclarationParts).not.toHaveBeenCalled();
      expect(findPhpMethodDeclarations).not.toHaveBeenCalled();
    }
  });

  it('una clase concreta con dependencias produce la misma sección que antes (sin campo ni bloque nuevos)', async () => {
    const scenario = fileDriverScenario();
    scenario.file[0] = classChunk(FILE_DRIVER, 'class FileDriver implements MappingDriver { }');
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('abstractObligations');
    expect(result?.text).not.toContain(OBLIGATIONS_HEADER);
    expect(result?.text).toBe(`Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los \`use\`):\n- FileLocator → ${NS}\\FileLocator (constructor)`);
  });

  it('una función (sin clase declarante) devuelve null como siempre', async () => {
    const scenario = fileDriverScenario();
    const { service } = makeRepository(scenario);
    const functionChunk = { ...targetFor(scenario), symbolKind: 'FUNCTION', parentSymbolName: null };

    await expect(service.resolve('version-1', [functionChunk], 'php')).resolves.toBeNull();
  });

  it('sin chunk de clase para el declarante no emite el bloque', async () => {
    const scenario = fileDriverScenario();
    scenario.file = scenario.file.filter((chunk) => chunk.symbolKind !== 'CLASS');
    const { service, findPhpTypeDeclarationParts } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toBeUndefined();
    expect(findPhpTypeDeclarationParts).not.toHaveBeenCalled();
  });

  it('un error de consulta de partes, de métodos o de tope deja la sección sin bloque y sin lanzar', async () => {
    const errors: Array<Partial<Record<'parts' | 'methods', Error>>> = [
      { parts: new TypeError('db down') },
      { parts: new PhpDeclarationQueryLimitError('findPhpTypeDeclarationParts', 400) },
    ];
    for (const failure of errors) {
      const scenario = fileDriverScenario();
      const { service } = makeRepository(scenario, failure);

      const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

      expect(result?.abstractObligations).toBeUndefined();
      expect(result?.text).not.toContain(OBLIGATIONS_HEADER);
      expect(result?.entries.map((entry) => entry.fqcn)).toEqual([`${NS}\\FileLocator`]);
    }

    const parentScenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [classChunk(`${NS}\\Leaf`, 'abstract class Leaf extends Base { }'), methodChunk(`${NS}\\Leaf`, 'abstract public function own(): void;')],
      types: { [`${NS}\\Base`]: { kind: 'CLASS', parts: ['abstract class Base { }'], methods: ['abstract public function hook(): void;'] } },
    };
    const { service } = makeRepository(parentScenario, { methods: new TypeError('db down') });
    // Si falla la consulta de métodos del padre no se afirma nada (ni siquiera los propios).
    const result = await service.resolve('version-1', [targetFor(parentScenario)], 'php');
    expect(result).toBeNull();
  });

  it('una interfaz declarante usa sus propias firmas y las de las interfaces que extiende', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Reader`,
      file: [
        {
          symbolKind: 'INTERFACE',
          symbolName: `${NS}\\Reader`,
          parentSymbolName: null,
          importsUsed: [],
          content: 'interface Reader extends Closer { public function read(): string; }',
        },
        methodChunk(`${NS}\\Reader`, 'public function read(): string;'),
      ],
      types: { [`${NS}\\Closer`]: { kind: 'INTERFACE', parts: ['interface Closer { public function close(): void; }'] } },
    };
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Reader::read(): string', 'Closer::close(): void']);
  });

  it('usa los imports y el namespace de cada tipo para resolver sus propios padres', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [classChunk(`${NS}\\Leaf`, 'abstract class Leaf extends Base { }'), methodChunk(`${NS}\\Leaf`, 'public function x(): void {}')],
      types: {
        [`${NS}\\Base`]: {
          kind: 'CLASS',
          parts: ['abstract class Base implements RemoteContract { }'],
          imports: ['Acme\\Remote\\RemoteContract'],
          methods: [],
        },
        'Acme\\Remote\\RemoteContract': { kind: 'INTERFACE', parts: ['interface RemoteContract { public function ping(): bool; }'] },
      },
    };
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['RemoteContract::ping(): bool']);
  });

  it('con una interfaz grande en varias partes concatena las firmas de todas las partes', async () => {
    const scenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [classChunk(`${NS}\\Leaf`, 'abstract class Leaf implements Big { }'), methodChunk(`${NS}\\Leaf`, 'public function x(): void {}')],
      types: {
        [`${NS}\\Big`]: {
          kind: 'INTERFACE',
          parts: ['interface Big {\n    public function first(): int;\n', '    public function second(): int;\n}'],
        },
      },
    };
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Big::first(): int', 'Big::second(): int']);
  });

  it('el máximo de 12 firmas recorta la lista pero no activa truncated', async () => {
    const methods = Array.from({ length: 15 }, (_, index) => `public function op${String(index).padStart(2, '0')}(): int;`).join('\n');
    const scenario: Scenario = {
      declaring: `${NS}\\Leaf`,
      file: [classChunk(`${NS}\\Leaf`, 'abstract class Leaf implements Wide { }'), methodChunk(`${NS}\\Leaf`, 'public function x(): void {}')],
      types: { [`${NS}\\Wide`]: { kind: 'INTERFACE', parts: [`interface Wide {\n${methods}\n}`] } },
    };
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toHaveLength(12);
    expect(result?.abstractObligations?.[0]).toBe('Wide::op00(): int');
    expect(result?.abstractObligations?.[11]).toBe('Wide::op11(): int');
    expect(result?.truncated).toBe(false);
    expect(result?.tokenCount).toBeLessThanOrEqual(500);
  });
});

const UNCERTAIN_HEADER =
  'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos; la jerarquía no se conoce por completo —trait o tipo fuera del índice—: la lista puede ser incompleta o incluir alguno ya implementado):';

function leafScenario(declaringContent: string, types: Record<string, FakeType>, extraFile: FakeFileChunk[] = []): Scenario {
  return {
    declaring: `${NS}\\Leaf`,
    file: [
      classChunk(`${NS}\\Leaf`, declaringContent),
      methodChunk(`${NS}\\Leaf`, 'public function x(): void {}'),
      ...extraFile,
    ],
    types,
  };
}

const CONTRACT_RUN: FakeType = { kind: 'INTERFACE', parts: ['interface Contract { public function run(): void; }'] };

describe('PhpDependencyContextService: aviso de jerarquía incompleta (WI-CORE-106)', () => {
  it('el escenario S1 (todo en el índice, sin traits) no lleva aviso ni campo de incertidumbre', async () => {
    const scenario = fileDriverScenario();
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.text).toContain(`${OBLIGATIONS_HEADER}\n- FileDriver::loadMappingFile`);
    expect(result?.text).not.toContain('no se conoce por completo');
    expect(result).not.toHaveProperty('abstractObligationsUncertain');
  });

  it('una clase declarante que usa traits declara la incertidumbre', async () => {
    const scenario = leafScenario('abstract class Leaf implements Contract { use Loggable; }', { [`${NS}\\Contract`]: CONTRACT_RUN });
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Contract::run(): void']);
    expect(result?.abstractObligationsUncertain).toBe(true);
    expect(result?.text).toContain(`${UNCERTAIN_HEADER}\n- Contract::run(): void`);
  });

  it('un use de namespace previo o de closure no cuenta como trait', async () => {
    const scenario = leafScenario(
      '<?php\nnamespace Acme\\Mapping;\n\nuse Acme\\Mapping\\Contract;\n\nabstract class Leaf implements Contract { public function f(): callable { return function () use ($x) {}; } }',
      { [`${NS}\\Contract`]: CONTRACT_RUN },
    );
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Contract::run(): void']);
    expect(result).not.toHaveProperty('abstractObligationsUncertain');
  });

  it('una clase ancestro que usa traits declara la incertidumbre', async () => {
    const scenario = leafScenario('abstract class Leaf extends Base { }', {
      [`${NS}\\Base`]: { kind: 'CLASS', parts: ['abstract class Base implements Contract { use Cacheable; }'], methods: [] },
      [`${NS}\\Contract`]: CONTRACT_RUN,
    });
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Contract::run(): void']);
    expect(result?.abstractObligationsUncertain).toBe(true);
  });

  it('un extends o implements que no resuelve a un tipo del índice declara la incertidumbre', async () => {
    const variants = [
      'abstract class Leaf implements Contract, \\Vendor\\Lib\\External { }',
      'abstract class Leaf implements Contract, Countable { }',
      'abstract class Leaf implements Contract, Phantom { }',
    ];
    for (const header of variants) {
      const scenario = leafScenario(header, { [`${NS}\\Contract`]: CONTRACT_RUN });
      const { service } = makeRepository(scenario);

      const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

      expect(result?.abstractObligations, header).toEqual(['Contract::run(): void']);
      expect(result?.abstractObligationsUncertain, header).toBe(true);
      expect(result?.text, header).toContain(UNCERTAIN_HEADER);
    }
  });

  it('un padre del índice cuyo propio extends sale del índice declara la incertidumbre', async () => {
    const scenario = leafScenario('abstract class Leaf extends Base { }', {
      [`${NS}\\Base`]: { kind: 'CLASS', parts: ['abstract class Base extends \\Vendor\\Lib\\Root implements Contract { }'], methods: [] },
      [`${NS}\\Contract`]: CONTRACT_RUN,
    });
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligationsUncertain).toBe(true);
  });

  it('un recorrido cortado por la profundidad 3 declara la incertidumbre; uno que termina en el nivel 3 no', async () => {
    const chain = (withLevel4: boolean) =>
      leafScenario('abstract class Leaf implements Level1 { }', {
        [`${NS}\\Level1`]: { kind: 'INTERFACE', parts: ['interface Level1 extends Level2 { public function one(): int; }'] },
        [`${NS}\\Level2`]: { kind: 'INTERFACE', parts: ['interface Level2 extends Level3 { public function two(): int; }'] },
        [`${NS}\\Level3`]: {
          kind: 'INTERFACE',
          parts: [`interface Level3 ${withLevel4 ? 'extends Level4 ' : ''}{ public function three(): int; }`],
        },
        [`${NS}\\Level4`]: { kind: 'INTERFACE', parts: ['interface Level4 { public function four(): int; }'] },
      });
    const cut = makeRepository(chain(true));
    const complete = makeRepository(chain(false));

    const cutResult = await cut.service.resolve('version-1', [targetFor(chain(true))], 'php');
    const completeResult = await complete.service.resolve('version-1', [targetFor(chain(false))], 'php');

    expect(cutResult?.abstractObligations).toEqual(['Level1::one(): int', 'Level2::two(): int', 'Level3::three(): int']);
    expect(cutResult?.abstractObligationsUncertain).toBe(true);
    expect(completeResult?.abstractObligations).toEqual(['Level1::one(): int', 'Level2::two(): int', 'Level3::three(): int']);
    expect(completeResult).not.toHaveProperty('abstractObligationsUncertain');
  });

  it('más de 20 tipos en un nivel: consulta 20 y declara la incertidumbre', async () => {
    const names = Array.from({ length: 25 }, (_, index) => `Contract${String(index).padStart(2, '0')}`);
    const types: Record<string, FakeType> = {};
    for (const name of names) types[`${NS}\\${name}`] = { kind: 'INTERFACE', parts: [`interface ${name} { public function op${name}(): int; }`] };
    const scenario = leafScenario(`abstract class Leaf implements ${names.join(', ')} { }`, types);
    const { service, partsCalls } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(partsCalls[0]).toHaveLength(20);
    expect(result?.abstractObligationsUncertain).toBe(true);
    expect(result?.abstractObligations).toHaveLength(12);
  });

  it('un método private de un padre no cuenta como implementado; uno protected o sin visibilidad sí', async () => {
    const scenario = leafScenario('abstract class Leaf extends Base { }', {
      [`${NS}\\Base`]: {
        kind: 'CLASS',
        parts: ['abstract class Base implements Contract { }'],
        methods: ['private function run(): void {}', 'protected function stop(): void {}', 'function pause(): void {}'],
      },
      [`${NS}\\Contract`]: {
        kind: 'INTERFACE',
        parts: ['interface Contract { public function run(): void; public function stop(): void; public function pause(): void; }'],
      },
    });
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Contract::run(): void']);
  });

  it('un método private del declarante tampoco implementa lo heredado', async () => {
    const scenario = leafScenario(
      'abstract class Leaf implements Contract { }',
      { [`${NS}\\Contract`]: CONTRACT_RUN },
      [methodChunk(`${NS}\\Leaf`, 'private function run(): void {}')],
    );
    const { service } = makeRepository(scenario);

    const result = await service.resolve('version-1', [targetFor(scenario)], 'php');

    expect(result?.abstractObligations).toEqual(['Contract::run(): void']);
  });

  it('con incertidumbre pero sin obligaciones que listar no hay bloque', async () => {
    const scenario = leafScenario('abstract class Leaf extends \\Vendor\\Lib\\Root { use Loggable; }', {});
    const { service } = makeRepository(scenario);

    await expect(service.resolve('version-1', [targetFor(scenario)], 'php')).resolves.toBeNull();
  });
});
