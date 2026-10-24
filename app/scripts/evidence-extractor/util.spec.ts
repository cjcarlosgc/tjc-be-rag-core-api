// WI-CORE-094: utilidades puras (JSON estable, CSV con escapes, saneado de secretos, nombres de archivo).
import { describe, expect, it } from 'vitest';
import { assertSafeSegment, canonicalJson, fileStem, scrubSecrets, sensitiveValuesFrom, stableStringify, toCsv } from './util.mjs';

describe('stableStringify', () => {
  it('ordena las claves de forma recursiva y termina en salto de línea, de modo reproducible', () => {
    const first = stableStringify({ b: 1, a: { d: [{ y: 2, x: 1 }], c: null } });
    const second = stableStringify({ a: { c: null, d: [{ x: 1, y: 2 }] }, b: 1 });
    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(first.indexOf('"a"')).toBeLessThan(first.indexOf('"b"'));
  });

  it('convierte fechas con toJSON y descarta undefined', () => {
    const text = stableStringify({ when: new Date('2026-10-24T10:00:00.000Z'), gone: undefined });
    expect(text).toContain('"when": "2026-10-24T10:00:00.000Z"');
    expect(text).not.toContain('gone');
  });
});

describe('canonicalJson', () => {
  it('serializa sin espacios y con claves ordenadas, como el producto', () => {
    expect(canonicalJson({ b: [1, 'x'], a: null })).toBe('{"a":null,"b":[1,"x"]}');
  });
});

describe('toCsv', () => {
  it('usa cabecera fija, escapa comillas, comas y saltos de línea', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'dice "hola"\nadiós' }, { a: null, b: 3 }]);
    expect(csv).toBe('a,b\n"x,y","dice ""hola""\nadiós"\n,3\n');
  });

  it('neutraliza celdas de texto que empiezan por fórmula', () => {
    const csv = toCsv(['v'], [{ v: '=HYPERLINK("http://x")' }, { v: '+1' }, { v: '@SUM' }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@SUM");
  });

  it('serializa objetos como JSON en una sola celda', () => {
    expect(toCsv(['o'], [{ o: { k: 'v' } }])).toBe('o\n"{""k"":""v""}"\n');
  });
});

describe('scrubSecrets', () => {
  it('sustituye cualquier aparición literal de los valores sensibles', () => {
    const url = 'postgresql://owner:TOPSECRETPW@db.example:5432/app';
    const text = `fallo al conectar a ${url} (${url})`;
    const scrubbed = scrubSecrets(text, [url]);
    expect(scrubbed).not.toContain('TOPSECRETPW');
    expect(scrubbed).toBe('fallo al conectar a [REDACTED] ([REDACTED])');
  });

  it('ignora valores vacíos y sustituye los más largos primero', () => {
    expect(scrubSecrets('abc', [''])).toBe('abc');
    expect(scrubSecrets('pass=ab/x', ['ab', 'pass=ab'])).toBe('[REDACTED]/x');
  });
});

describe('fileStem y assertSafeSegment', () => {
  it('convierte nombres libres en nombres de archivo seguros', () => {
    expect(fileStem('Money::add/../evil name')).toBe('Money_add_._evil_name');
    expect(fileStem('')).toBe('sin-nombre');
    expect(fileStem('x'.repeat(200))).toHaveLength(80);
  });

  it('rechaza segmentos con separadores o con ..', () => {
    expect(() => assertSafeSegment('ok.txt')).not.toThrow();
    expect(() => assertSafeSegment('../etc')).toThrow();
    expect(() => assertSafeSegment('a/b')).toThrow();
    expect(() => assertSafeSegment('..')).toThrow();
  });
});

describe('saneado por partes del DSN (SEC-08)', () => {
  it('sensitiveValuesFrom incluye usuario, contraseña (en bruto y decodificada) y host', () => {
    const values = sensitiveValuesFrom({
      DATABASE_URL: 'postgresql://usuario-x:cl%40ve-y@db-host.example.test:5432/app',
      SUPABASE_URL: 'https://proyecto-z.example.test',
      SUPABASE_SECRET_KEY: 'sb_secret_abc',
    });
    for (const expected of ['usuario-x', 'cl%40ve-y', 'cl@ve-y', 'db-host.example.test', 'proyecto-z.example.test', 'sb_secret_abc']) {
      expect(values).toContain(expected);
    }
  });

  it('scrubSecrets elimina una contraseña suelta citada en un mensaje de error', () => {
    const secrets = sensitiveValuesFrom({ DATABASE_URL: 'postgresql://u:HostileSecret9@h.example.test/db' });
    const message = 'fallo de autenticación para HostileSecret9 en h.example.test';
    const scrubbed = scrubSecrets(message, secrets);
    expect(scrubbed).not.toContain('HostileSecret9');
    expect(scrubbed).not.toContain('h.example.test');
  });

  it('una URL malformada no rompe el cálculo y conserva la variante completa', () => {
    expect(sensitiveValuesFrom({ DATABASE_URL: 'no es una url %%' })).toEqual(['no es una url %%']);
  });
});

describe('fileStem sin abortar (SEC-05)', () => {
  it('colapsa secuencias de puntos y el resultado es un segmento seguro', () => {
    expect(fileStem('Foo..bar')).toBe('Foo.bar');
    expect(() => assertSafeSegment(`01-${fileStem('Foo..bar')}.php`)).not.toThrow();
    expect(fileStem('..')).toBe('sin-nombre');
    expect(fileStem('../../etc')).not.toContain('..');
  });
});
