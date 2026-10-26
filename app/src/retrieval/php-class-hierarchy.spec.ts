import { describe, expect, it } from 'vitest';
import {
  computeInheritedAbstractObligations,
  extractPhpAbstractMethod,
  extractPhpImplementedMethodName,
  extractPhpInterfaceMethodSignatures,
  extractPhpMethodName,
  parsePhpTypeHeader,
  phpClassUsesTraits,
  renderPhpAbstractObligations,
  type AncestorHierarchyInfo,
} from './php-class-hierarchy.js';

describe('parsePhpTypeHeader (WI-CORE-106)', () => {
  it('lee clase abstracta con extends e implements múltiple', () => {
    expect(
      parsePhpTypeHeader('abstract class Repo extends BaseRepo implements Countable, \\Shop\\Contracts\\Reader\n{\n}'),
    ).toEqual({
      kind: 'class',
      isAbstract: true,
      extendsNames: ['BaseRepo'],
      implementsNames: ['Countable', '\\Shop\\Contracts\\Reader'],
    });
  });

  it('acepta final, readonly y abstract en cualquier orden permitido', () => {
    expect(parsePhpTypeHeader('final readonly class A {}')).toMatchObject({ kind: 'class', isAbstract: false });
    expect(parsePhpTypeHeader('readonly abstract class A {}')).toMatchObject({ kind: 'class', isAbstract: true });
    expect(parsePhpTypeHeader('abstract readonly class A {}')).toMatchObject({ kind: 'class', isAbstract: true });
    expect(parsePhpTypeHeader('class A {}')).toMatchObject({ kind: 'class', isAbstract: false });
  });

  it('interface con extends de varias interfaces', () => {
    expect(parsePhpTypeHeader('interface Driver extends Reader, \\Shop\\Writer { public function a(): void; }')).toEqual({
      kind: 'interface',
      isAbstract: false,
      extendsNames: ['Reader', '\\Shop\\Writer'],
      implementsNames: [],
    });
  });

  it('ignora <?php, namespace, use, docblocks, comentarios y atributos con las palabras abstract o class', () => {
    const content = `<?php
declare(strict_types=1);

namespace Shop\\Storage;

use Shop\\Contracts\\Reader;
use Shop\\Contracts\\{Writer, Closer};

// abstract class Fake extends Nope
/**
 * abstract class Docblock implements Nada
 */
#[Attr('abstract class Hidden extends Wrong')]
# class Another {}
abstract /* class Inline */ class Real // implements Ghost
    extends Parent_ /* interface X */
    implements Reader
{
}`;

    expect(parsePhpTypeHeader(content)).toEqual({
      kind: 'class',
      isAbstract: true,
      extendsNames: ['Parent_'],
      implementsNames: ['Reader'],
    });
  });

  it('trait y enum se reconocen como tales (no son clases)', () => {
    expect(parsePhpTypeHeader('trait T { }')).toMatchObject({ kind: 'trait', isAbstract: false });
    expect(parsePhpTypeHeader('enum Status: string implements HasLabel { case A = "a"; }')).toEqual({
      kind: 'enum',
      isAbstract: false,
      extendsNames: [],
      implementsNames: ['HasLabel'],
    });
  });

  it('devuelve null ante cabeceras ilegibles o ambiguas', () => {
    expect(parsePhpTypeHeader('')).toBeNull();
    expect(parsePhpTypeHeader('function helper(): void {}')).toBeNull();
    expect(parsePhpTypeHeader('abstract class A extends B, C {}')).toBeNull();
    expect(parsePhpTypeHeader('interface I implements J {}')).toBeNull();
    expect(parsePhpTypeHeader('class A extends {}')).toBeNull();
    expect(parsePhpTypeHeader('class A extends B implements')).toBeNull();
    expect(parsePhpTypeHeader('class A extends 12x {}')).toBeNull();
    expect(parsePhpTypeHeader('abstract class A /* sin llave')).toBeNull();
    expect(parsePhpTypeHeader(undefined as unknown as string)).toBeNull();
  });
});

describe('extractPhpInterfaceMethodSignatures (WI-CORE-106)', () => {
  it('extrae firmas con nullable, uniones, static, valores por defecto y parámetros multilínea', () => {
    const content = `interface Store
{
    /** function ghost(): void; */
    // public function comment(): void;
    public function find(string $id, ?array $options = null): ?Item;

    public static function create(
        int|string $key,
        array $values = ['a', 'b'],
        #[Sensitive] string $secret = 'x;y',
    ): static;

    function noReturn($value);

    #[Deprecated]
    public function mixedResult(int $a = 1) : int|false ;
}`;

    expect(extractPhpInterfaceMethodSignatures(content)).toEqual([
      "find(string $id, ?array $options = null): ?Item",
      "create(int|string $key, array $values = ['a', 'b'], string $secret = 'x;y'): static",
      'noReturn($value)',
      'mixedResult(int $a = 1): int|false',
    ]);
  });

  it('omite métodos con cuerpo, firmas incompletas y no lanza con contenido vacío', () => {
    expect(extractPhpInterfaceMethodSignatures('interface I { public function a(): void { } }')).toEqual([]);
    expect(extractPhpInterfaceMethodSignatures('interface I { public function a(int $x')).toEqual([]);
    expect(extractPhpInterfaceMethodSignatures('')).toEqual([]);
    expect(extractPhpInterfaceMethodSignatures(null as unknown as string)).toEqual([]);
  });

  it('concatenar las partes de una interfaz grande conserva las firmas completas de cada parte', () => {
    const part1 = 'interface Big {\n    public function first(): int;\n';
    const part2 = '    public function second(string $a): string;\n}';

    expect(extractPhpInterfaceMethodSignatures(`${part1}\n${part2}`)).toEqual(['first(): int', 'second(string $a): string']);
  });
});

describe('extractPhpAbstractMethod y extractPhpMethodName (WI-CORE-106)', () => {
  it('abstract protected con tipos complejos y docblock', () => {
    const content = `/**
 * function ignored(): void { }
 */
#[Internal]
abstract protected function loadMappingFile(
    string $file,
    ?int $flags = 0
): array|null;`;

    expect(extractPhpAbstractMethod(content)).toEqual({
      name: 'loadMappingFile',
      signature: 'loadMappingFile(string $file, ?int $flags = 0): array|null',
    });
  });

  it('acepta public abstract static y abstract sin visibilidad ni retorno', () => {
    expect(extractPhpAbstractMethod('public abstract static function build(): static;')).toEqual({
      name: 'build',
      signature: 'build(): static',
    });
    expect(extractPhpAbstractMethod('abstract function run($a);')).toEqual({ name: 'run', signature: 'run($a)' });
  });

  it('devuelve null si no es abstracto, es privado, final o tiene cuerpo', () => {
    expect(extractPhpAbstractMethod('public function a(): void {}')).toBeNull();
    expect(extractPhpAbstractMethod('abstract private function a(): void;')).toBeNull();
    expect(extractPhpAbstractMethod('abstract final function a(): void;')).toBeNull();
    expect(extractPhpAbstractMethod('abstract public function a(): void { return; }')).toBeNull();
    expect(extractPhpAbstractMethod('// abstract public function a(): void;\npublic function b(): void {}')).toBeNull();
    expect(extractPhpAbstractMethod('abstract public function a(')).toBeNull();
    expect(extractPhpAbstractMethod(undefined as unknown as string)).toBeNull();
  });

  it('extractPhpMethodName lee el nombre ignorando docblocks, atributos y modificadores', () => {
    expect(extractPhpMethodName('/** function x() */ #[A]\npublic static function &compute(int $a): int { }')).toBe('compute');
    expect(extractPhpMethodName('protected final function __construct() {}')).toBe('__construct');
    expect(extractPhpMethodName('$closure = function () {};')).toBeNull();
    expect(extractPhpMethodName('')).toBeNull();
  });
});

describe('extractPhpImplementedMethodName (WI-CORE-106)', () => {
  it('cuenta public, protected y sin visibilidad; no cuenta private, abstract ni lo ilegible', () => {
    expect(extractPhpImplementedMethodName('public function a(): void {}')).toBe('a');
    expect(extractPhpImplementedMethodName('protected function b(): void {}')).toBe('b');
    expect(extractPhpImplementedMethodName('function c() {}')).toBe('c');
    expect(extractPhpImplementedMethodName('/** doc */ #[A]\npublic static function d(): void {}')).toBe('d');
    expect(extractPhpImplementedMethodName('private function e(): void {}')).toBeNull();
    expect(extractPhpImplementedMethodName('private static function e(): void {}')).toBeNull();
    expect(extractPhpImplementedMethodName('abstract protected function f(): void;')).toBeNull();
    expect(extractPhpImplementedMethodName('$x = 1;')).toBeNull();
    expect(extractPhpImplementedMethodName(undefined as unknown as string)).toBeNull();
  });
});

describe('phpClassUsesTraits (WI-CORE-106)', () => {
  it('detecta un trait simple, varios y uno con bloque de resolución de conflictos', () => {
    expect(phpClassUsesTraits('abstract class A { use Loggable; public function a(): void {} }')).toBe(true);
    expect(phpClassUsesTraits('abstract class A {\n    use Loggable, \\Shop\\Cacheable;\n}')).toBe(true);
    expect(
      phpClassUsesTraits(`abstract class A
{
    use Loggable, Cacheable {
        Loggable::log insteadof Cacheable;
        Cacheable::log as protected cacheLog;
    }

    public function a(): void {}
}`),
    ).toBe(true);
  });

  it('un use de trait más abajo en el cuerpo, tras propiedades y métodos, también cuenta', () => {
    expect(phpClassUsesTraits('abstract class A { public int $x = 0; public function a(): void { if (true) { $y = 1; } } use Late; }')).toBe(true);
  });

  it('no cuenta los use de namespace anteriores a la clase', () => {
    const content = `<?php
namespace Shop;

use Shop\\Contracts\\Reader;
use Shop\\Support\\{Clock, Formatter};

abstract class A implements Reader
{
    public function a(): void {}
}`;

    expect(phpClassUsesTraits(content)).toBe(false);
  });

  it('no cuenta el use de un closure dentro de un método', () => {
    expect(
      phpClassUsesTraits(
        'abstract class A { public function a(int $x): callable { return function () use ($x) { return $x; }; } public function b(): void {} }',
      ),
    ).toBe(false);
  });

  it('no cuenta use en comentarios, docblocks, cadenas ni atributos', () => {
    const content = `abstract class A
{
    // use Foo;
    /* use Bar; */
    /** use Baz; */
    #[Attr('use Nope;')]
    public string $text = 'use Qux;';

    public function a(): void {}
}`;

    expect(phpClassUsesTraits(content)).toBe(false);
  });

  it('una clase sin traits ni cuerpo con contenido da false y una cabecera o cuerpo ilegible da true (incierto)', () => {
    expect(phpClassUsesTraits('abstract class A { }')).toBe(false);
    expect(phpClassUsesTraits('')).toBe(true);
    expect(phpClassUsesTraits('function helper(): void {}')).toBe(true);
    expect(phpClassUsesTraits('abstract class A extends')).toBe(true);
    expect(phpClassUsesTraits(undefined as unknown as string)).toBe(true);
  });
});

function ancestor(overrides: Partial<AncestorHierarchyInfo> & Pick<AncestorHierarchyInfo, 'name'>): AncestorHierarchyInfo {
  return { kind: 'interface', level: 1, abstractMethods: [], implementedMethodNames: [], ...overrides };
}

const declaringBase = { name: 'Driver', isAbstract: true, implementedMethodNames: [], abstractMethods: [] };

describe('computeInheritedAbstractObligations (WI-CORE-106)', () => {
  it('une abstractos propios y de ancestros, restando los implementados por el declarante', () => {
    const result = computeInheritedAbstractObligations({
      declaring: {
        ...declaringBase,
        implementedMethodNames: ['isTransient'],
        abstractMethods: [{ name: 'loadFile', signature: 'loadFile(string $f): array' }],
      },
      ancestors: [
        ancestor({
          name: 'Mapping',
          abstractMethods: [
            { name: 'loadMetadata', signature: 'loadMetadata(string $c): void' },
            { name: 'isTransient', signature: 'isTransient(string $c): bool' },
          ],
        }),
      ],
    });

    expect(result).toEqual({
      methods: [
        { owner: 'Driver', signature: 'loadFile(string $f): array' },
        { owner: 'Mapping', signature: 'loadMetadata(string $c): void' },
      ],
      truncatedByLimit: false,
    });
  });

  it('resta lo implementado por un padre concreto o abstracto con cuerpo, incluso en un nivel más profundo', () => {
    const result = computeInheritedAbstractObligations({
      declaring: declaringBase,
      ancestors: [
        ancestor({ name: 'Base', kind: 'class', level: 1, implementedMethodNames: ['Alpha'] }),
        ancestor({
          name: 'Contract',
          level: 2,
          abstractMethods: [
            { name: 'alpha', signature: 'alpha(): int' },
            { name: 'beta', signature: 'beta(): int' },
          ],
        }),
      ],
    });

    expect(result.methods).toEqual([{ owner: 'Contract', signature: 'beta(): int' }]);
  });

  it('un método redeclarado abstract en una clase más cercana sigue abstracto aunque un ancestro lo implemente', () => {
    const result = computeInheritedAbstractObligations({
      declaring: { ...declaringBase, abstractMethods: [{ name: 'render', signature: 'render(): string' }] },
      ancestors: [ancestor({ name: 'Base', kind: 'class', level: 1, implementedMethodNames: ['render'] })],
    });

    expect(result.methods).toEqual([{ owner: 'Driver', signature: 'render(): string' }]);
  });

  it('un padre que implementa lo que un abuelo declara abstracto lo deja implementado', () => {
    const result = computeInheritedAbstractObligations({
      declaring: declaringBase,
      ancestors: [
        ancestor({ name: 'Parent', kind: 'class', level: 1, implementedMethodNames: ['render'] }),
        ancestor({
          name: 'Grand',
          kind: 'class',
          level: 2,
          abstractMethods: [{ name: 'render', signature: 'render(): string' }],
        }),
      ],
    });

    expect(result.methods).toEqual([]);
  });

  it('sin duplicados por nombre de método: gana el nivel más cercano', () => {
    const result = computeInheritedAbstractObligations({
      declaring: declaringBase,
      ancestors: [
        ancestor({ name: 'Far', level: 3, abstractMethods: [{ name: 'Run', signature: 'Run(int $far): void' }] }),
        ancestor({ name: 'Near', level: 1, abstractMethods: [{ name: 'run', signature: 'run(int $near): void' }] }),
      ],
    });

    expect(result.methods).toEqual([{ owner: 'Near', signature: 'run(int $near): void' }]);
  });

  it('orden estable por nivel y luego por nombre', () => {
    const result = computeInheritedAbstractObligations({
      declaring: { ...declaringBase, abstractMethods: [{ name: 'zeta', signature: 'zeta(): void' }] },
      ancestors: [
        ancestor({
          name: 'L2',
          level: 2,
          abstractMethods: [{ name: 'alpha', signature: 'alpha(): void' }],
        }),
        ancestor({
          name: 'L1',
          level: 1,
          abstractMethods: [
            { name: 'mid', signature: 'mid(): void' },
            { name: 'beta', signature: 'beta(): void' },
          ],
        }),
      ],
    });

    expect(result.methods.map((method) => method.signature)).toEqual(['zeta(): void', 'beta(): void', 'mid(): void', 'alpha(): void']);
  });

  it('tope de 12: recorta por orden y solo marca truncatedByLimit (no es truncated de la sección)', () => {
    const abstractMethods = Array.from({ length: 15 }, (_, index) => {
      const name = `m${String(index).padStart(2, '0')}`;
      return { name, signature: `${name}(): void` };
    });

    const result = computeInheritedAbstractObligations({ declaring: declaringBase, ancestors: [ancestor({ name: 'Big', abstractMethods })] });

    expect(result.methods).toHaveLength(12);
    expect(result.methods[0].signature).toBe('m00(): void');
    expect(result.methods[11].signature).toBe('m11(): void');
    expect(result.truncatedByLimit).toBe(true);

    const exact = computeInheritedAbstractObligations({
      declaring: declaringBase,
      ancestors: [ancestor({ name: 'Big', abstractMethods: abstractMethods.slice(0, 12) })],
    });
    expect(exact.methods).toHaveLength(12);
    expect(exact.truncatedByLimit).toBe(false);
  });

  it('un declarante no abstracto no produce obligaciones y entradas inválidas no lanzan', () => {
    expect(
      computeInheritedAbstractObligations({
        declaring: { ...declaringBase, isAbstract: false, abstractMethods: [{ name: 'a', signature: 'a(): void' }] },
        ancestors: [],
      }),
    ).toEqual({ methods: [], truncatedByLimit: false });
    expect(computeInheritedAbstractObligations(undefined as never)).toEqual({ methods: [], truncatedByLimit: false });
  });
});

describe('renderPhpAbstractObligations (WI-CORE-106)', () => {
  it('render exacto con encabezado y líneas Owner::firma', () => {
    expect(
      renderPhpAbstractObligations([
        { owner: 'Driver', signature: 'loadFile(string $f): array' },
        { owner: 'Mapping', signature: 'loadMetadata(string $c): void' },
      ]),
    ).toBe(
      'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos):\n' +
        '- Driver::loadFile(string $f): array\n' +
        '- Mapping::loadMetadata(string $c): void',
    );
  });

  it('con jerarquía incierta el encabezado declara que la lista puede ser incompleta', () => {
    expect(renderPhpAbstractObligations([{ owner: 'Driver', signature: 'loadFile(): array' }], true)).toBe(
      'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos; la jerarquía no se conoce por completo —trait o tipo fuera del índice—: la lista puede ser incompleta o incluir alguno ya implementado):\n' +
        '- Driver::loadFile(): array',
    );
  });

  it('devuelve cadena vacía sin métodos, también con incertidumbre', () => {
    expect(renderPhpAbstractObligations([])).toBe('');
    expect(renderPhpAbstractObligations([], true)).toBe('');
  });
});
