// WI-CORE-107: pruebas de las primitivas puras del CLI OE2 (argumentos, CSV, PRNG, escáner de firma PHP).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseOe2Arguments, SUBCOMMANDS } from './args.mjs';
import { UsageError } from '../evidence-extractor/options.mjs';
import { toCsv } from '../evidence-extractor/util.mjs';
import {
  createMulberry32,
  hex32,
  parseCsv,
  parseChunksJsonl,
  seedStateFromText,
  shuffleInPlace,
  assertSafeRelativePath,
} from './io-primitives.mjs';
import { hasBody, scanFunctionSignature } from './php-signature.mjs';
import { chunk, toJsonl } from './fixtures.mjs';

const SHA = 'a'.repeat(64);

describe('parseOe2Arguments', () => {
  it('reconoce los siete subcomandos y la ayuda', () => {
    expect(SUBCOMMANDS).toEqual(['dump-chunks', 'dump-results', 'compare-dumps', 'sample', 'support-files', 'pool', 'score']);
    expect(parseOe2Arguments([]).help).toBe(true);
    expect(parseOe2Arguments(['--help']).help).toBe(true);
    expect(parseOe2Arguments(['sample', '--help']).help).toBe(true);
  });

  it('dump-chunks exige --project-version y --out', () => {
    const parsed = parseOe2Arguments(['dump-chunks', '--project-version', 'pv-1', '--out', '/tmp/x']);
    expect(parsed.options).toMatchObject({ projectVersion: 'pv-1', out: '/tmp/x', allowOutInRepo: false });
    expect(() => parseOe2Arguments(['dump-chunks', '--project-version', 'pv-1'])).toThrow(/--out/);
    expect(() => parseOe2Arguments(['dump-chunks', '--out', '/tmp/x'])).toThrow(/--project-version/);
  });

  it('dump-results acepta --analysis-run o varios --comparison, pero no ambos ni ninguno', () => {
    const byRun = parseOe2Arguments(['dump-results', '--analysis-run', 'run-1', '--out', '/tmp/x']);
    expect(byRun.options.analysisRun).toBe('run-1');
    const byIds = parseOe2Arguments(['dump-results', '--comparison', 'c1', '--comparison', 'c2', '--out', '/tmp/x']);
    expect(byIds.options.comparisons).toEqual(['c1', 'c2']);
    expect(() => parseOe2Arguments(['dump-results', '--analysis-run', 'r', '--comparison', 'c', '--out', '/tmp/x'])).toThrow(UsageError);
    expect(() => parseOe2Arguments(['dump-results', '--out', '/tmp/x'])).toThrow(UsageError);
  });

  it('rechaza identificadores con formato no válido y opciones desconocidas', () => {
    expect(() => parseOe2Arguments(['dump-chunks', '--project-version', 'pv 1', '--out', '/tmp/x'])).toThrow(/formato/);
    expect(() => parseOe2Arguments(['dump-chunks', '--project-version', 'pv-1', '--out', '/tmp/x', '--zzz'])).toThrow(/no admitida/);
    expect(() => parseOe2Arguments(['bogus'])).toThrow(/subcomando desconocido/);
  });

  it('sample aplica los valores por defecto 3/3/12 y permite --repo', () => {
    const parsed = parseOe2Arguments(['sample', '--dump', 'c.jsonl', '--seed', 's', '--out', '/tmp/x']);
    expect(parsed.options).toMatchObject({ calibration: 3, reserve: 3, official: 12 });
    expect(parsed.options.repo).toBeUndefined();
    const custom = parseOe2Arguments(['sample', '--dump', 'c.jsonl', '--seed', 's', '--out', '/tmp/x', '--calibration', '1', '--repo', 'money']);
    expect(custom.options).toMatchObject({ calibration: 1, repo: 'money' });
  });

  it('sample rechaza enteros no válidos y un sorteo vacío', () => {
    expect(() => parseOe2Arguments(['sample', '--dump', 'c', '--seed', 's', '--out', '/x', '--official', '-2'])).toThrow(/entero/);
    expect(() => parseOe2Arguments(['sample', '--dump', 'c', '--seed', 's', '--out', '/x', '--calibration', '0', '--reserve', '0', '--official', '0'])).toThrow(/al menos un target/);
  });

  it('pool fija --max-chars por defecto y exige un mínimo', () => {
    const parsed = parseOe2Arguments(['pool', '--dump', 'c', '--sample', 's.csv', '--results', 'r', '--seed', 's', '--out', '/x']);
    expect(parsed.options.maxChars).toBe(6000);
    expect(() => parseOe2Arguments(['pool', '--dump', 'c', '--sample', 's.csv', '--results', 'r', '--seed', 's', '--out', '/x', '--max-chars', '10'])).toThrow(/al menos 200/);
  });

  it('score exige un SHA-256 hexadecimal y lo normaliza a minúsculas', () => {
    const parsed = parseOe2Arguments(['score', '--results', 'r', '--gt', 'g.json', '--gt-sha256', SHA.toUpperCase(), '--sample', 's.csv', '--out', '/x', '--include-calibration']);
    expect(parsed.options.gtSha256).toBe(SHA);
    expect(parsed.options.includeCalibration).toBe(true);
    expect(() => parseOe2Arguments(['score', '--results', 'r', '--gt', 'g.json', '--gt-sha256', 'xyz', '--sample', 's.csv', '--out', '/x'])).toThrow(/SHA-256/);
  });

  it('una opción repetida o sin valor es un error de uso', () => {
    expect(() => parseOe2Arguments(['sample', '--dump', 'a', '--dump', 'b', '--seed', 's', '--out', '/x'])).toThrow(/repetida/);
    expect(() => parseOe2Arguments(['sample', '--dump', '--seed', 's', '--out', '/x'])).toThrow(/necesita un valor/);
  });

  it('compare-dumps no exige --out', () => {
    expect(parseOe2Arguments(['compare-dumps', '--a', 'a.jsonl', '--b', 'b.jsonl']).options.out).toBeNull();
  });
});

describe('CSV (lectura inversa de toCsv)', () => {
  it('lee lo que escribe toCsv, incluidas comillas, comas y saltos de línea', () => {
    const rows = [
      { a: 'x,y', b: 'dice "hola"', c: 'línea\nnueva' },
      { a: '', b: 'plano', c: 'ñ-unicode' },
    ];
    const text = toCsv(['a', 'b', 'c'], rows);
    const parsed = parseCsv(text);
    expect(parsed.header).toEqual(['a', 'b', 'c']);
    expect(parsed.rows).toEqual(rows);
  });

  it('acepta CRLF y rechaza una fila con columnas de más', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([{ a: '1', b: '2' }]);
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/columnas/);
    expect(() => parseCsv('a\n"sin cerrar\n')).toThrow(/sin cerrar/);
  });
});

describe('PRNG y barajado', () => {
  it('la semilla es el primer entero de 32 bits big-endian del SHA-256 de la semilla en UTF-8', () => {
    const digest = createHash('sha256').update('semilla-de-prueba', 'utf8').digest();
    expect(seedStateFromText('semilla-de-prueba')).toBe(digest.readUInt32BE(0));
    expect(seedStateFromText('otra')).not.toBe(seedStateFromText('semilla-de-prueba'));
  });

  it('mulberry32 coincide con la referencia clásica en valores en [0, 1)', () => {
    // Referencia independiente (forma clásica con números de punto flotante) para comprobar la versión entera.
    const reference = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const local = createMulberry32(123456789);
    const expected = reference(123456789);
    for (let index = 0; index < 50; index += 1) {
      expect(local() / 4294967296).toBe(expected());
    }
  });

  it('el barajado es determinista, cambia con la semilla y es una permutación', () => {
    const items = Array.from({ length: 12 }, (_, index) => `item-${index}`);
    const first = shuffleInPlace([...items], createMulberry32(seedStateFromText('A')));
    const again = shuffleInPlace([...items], createMulberry32(seedStateFromText('A')));
    const other = shuffleInPlace([...items], createMulberry32(seedStateFromText('B')));
    expect(first).toEqual(again);
    expect([...first].sort()).toEqual([...items].sort());
    expect(other).not.toEqual(first);
  });

  it('la primera salida cruda se formatea en 8 dígitos hexadecimales', () => {
    expect(hex32(255)).toBe('000000ff');
    expect(hex32(0xffffffff)).toBe('ffffffff');
  });
});

describe('escáner de firma PHP (hasBody)', () => {
  it('método concreto: tiene cuerpo', () => {
    expect(hasBody('    public function a(): int\n    {\n        return 1;\n    }\n')).toBe(true);
  });

  it('método abstracto e interfaz: no tiene cuerpo', () => {
    expect(hasBody('abstract public function a(): int;')).toBe(false);
    expect(hasBody('public function a(string $x = "a;b{"): ?array;')).toBe(false);
  });

  it('ignora atributos #[...] que contienen ; o { y cadenas en valores por defecto', () => {
    const source = "#[Route('/x;{')]\npublic function a(#[SensitiveParameter] $p = 'x;{'): static\n{\n}\n";
    expect(hasBody(source)).toBe(true);
  });

  it('tipos de retorno compuestos (unión, nullable, DNF) con y sin cuerpo', () => {
    expect(hasBody('function f(array $a = [\'k\' => "}"]): int|string { return 1; }')).toBe(true);
    expect(hasBody('public function g(): ?array { return null; }')).toBe(true);
    expect(hasBody('public function h(): (A&B)|null;')).toBe(false);
    expect(hasBody('public function k(): (A&B)|null { return null; }')).toBe(true);
  });

  it('funciones libres y firmas con referencia &', () => {
    expect(hasBody('function free(): void {}')).toBe(true);
    expect(hasBody('function &ref(array &$a): array { return $a; }')).toBe(true);
  });

  it('ignora comentarios que contienen la palabra function y firmas falsas', () => {
    const source = '/* function fake() { */\n// function other();\npublic function real(): void;';
    expect(scanFunctionSignature(source)).toEqual({ found: true, hasBody: false });
  });

  it('sin palabra function no hay firma', () => {
    expect(scanFunctionSignature('class X {}')).toEqual({ found: false, hasBody: null });
  });
});

describe('rutas seguras y lectura de chunks.jsonl', () => {
  it('acepta rutas relativas y rechaza absolutas, con .. o con separadores de Windows', () => {
    expect(assertSafeRelativePath('src/A.php')).toBe('src/A.php');
    for (const bad of ['/etc/x.php', '../x.php', 'a/../b.php', 'a//b.php', 'C:/x.php', 'a\\b.php', '']) {
      expect(() => assertSafeRelativePath(bad), bad).toThrow();
    }
  });

  it('verifica contentSha256 y rechaza líneas sin campos obligatorios', () => {
    const good = chunk({ filePath: 'a.php', symbolKind: 'FUNCTION', symbolName: 'a', content: 'function a() {}' });
    expect(parseChunksJsonl(toJsonl([good]))).toHaveLength(1);
    const tampered = { ...good, content: 'function b() {}' };
    expect(() => parseChunksJsonl(toJsonl([tampered]))).toThrow(/contentSha256/);
    expect(() => parseChunksJsonl('{"filePath":"a"}\n')).toThrow(/falta/);
    expect(() => parseChunksJsonl('no json\n')).toThrow(/JSON/);
  });
});

// M-2: golden del barajado puro (orden fijado a mano, calculado de forma independiente en Python).
describe('golden del barajado (M-2)', () => {
  const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('Fisher–Yates descendente con semilla fija produce el orden fijado a mano', () => {
    expect(shuffleInPlace([...ITEMS], createMulberry32(seedStateFromText('golden-puro')))).toEqual(['g', 'h', 'e', 'c', 'd', 'a', 'b', 'f']);
  });

  it('el barajado ascendente produce otro orden, así que la prueba lo distingue', () => {
    const forward = [...ITEMS];
    const generator = createMulberry32(seedStateFromText('golden-puro'));
    const n = forward.length;
    for (let i = 0; i < n - 1; i += 1) {
      const j = i + Math.floor((generator() / 4294967296) * (n - i));
      [forward[i], forward[j]] = [forward[j], forward[i]];
    }
    expect(forward).toEqual(['f', 'c', 'b', 'g', 'd', 'h', 'e', 'a']);
    expect(forward).not.toEqual(['g', 'h', 'e', 'c', 'd', 'a', 'b', 'f']);
  });

  it('la semilla "golden-puro" fija el estado a 32 bits (valor independiente)', () => {
    expect(seedStateFromText('golden-puro').toString(16).padStart(8, '0')).toBe(
      createHash('sha256').update('golden-puro', 'utf8').digest().subarray(0, 4).toString('hex'),
    );
  });
});
