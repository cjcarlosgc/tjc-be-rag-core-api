import { describe, expect, it } from 'vitest';
import {
  buildPhpFqcnGlossary,
  composePhpDependencySection,
  countPhpDependencyTokens,
  MAX_PHP_FQCN_GLOSSARY_ENTRIES,
  renderPhpDependencySection,
  renderPhpFqcnGlossary,
  type PhpDependencyEntry,
  type PhpDependencySection,
  type PhpFqcnGlossaryEntry,
} from './php-dependency-context.js';

const GLOSSARY_HEADER = 'Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:';

function dependency(overrides: Partial<PhpDependencyEntry> = {}): PhpDependencyEntry {
  return {
    typeName: 'Money',
    fqcn: 'Brick\\Money\\Money',
    origin: 'CONSTRUCTOR',
    resolvedBy: 'IMPORT',
    ...overrides,
  };
}

function section(entries: PhpDependencyEntry[], overrides: Partial<PhpDependencySection> = {}): PhpDependencySection {
  const transitiveEntries = entries.filter((entry) => entry.via !== undefined);
  const directEntries = entries.filter((entry) => entry.via === undefined);
  const text = renderPhpDependencySection(entries);
  return {
    entries: directEntries,
    transitiveEntries,
    unresolvedCount: 0,
    truncated: false,
    tokenCount: countPhpDependencyTokens(text),
    text,
    ...overrides,
  };
}

function makeGlossary(count: number, prefix = 'Vendor\\Pkg\\Type'): PhpFqcnGlossaryEntry[] {
  return Array.from({ length: count }, (_, i) => ({ typeName: `Type${i}`, fqcn: `${prefix.replace(/Type$/, '')}Type${i}` }));
}

describe('buildPhpFqcnGlossary (WI-CORE-104, R2b)', () => {
  it('une los grupos en orden (target primero), quita el \\ inicial y toma el último segmento como nombre', () => {
    const glossary = buildPhpFqcnGlossary({
      importGroups: [
        ['\\Brick\\Money\\Context\\AutoContext', 'Brick\\Money\\Currency'],
        ['Brick\\Math\\RoundingMode'],
        ['Brick\\Money\\Context\\CashContext'],
      ],
      excludeFqcns: new Set(),
    });

    expect(glossary).toEqual([
      { typeName: 'AutoContext', fqcn: 'Brick\\Money\\Context\\AutoContext' },
      { typeName: 'Currency', fqcn: 'Brick\\Money\\Currency' },
      { typeName: 'RoundingMode', fqcn: 'Brick\\Math\\RoundingMode' },
      { typeName: 'CashContext', fqcn: 'Brick\\Money\\Context\\CashContext' },
    ]);
  });

  it('deduplica por FQCN (con o sin \\ inicial) y excluye dependencias y la clase declarante', () => {
    const glossary = buildPhpFqcnGlossary({
      importGroups: [
        ['Brick\\Money\\Money', 'Brick\\Money\\Currency'],
        ['\\Brick\\Money\\Currency', 'Brick\\Money\\MoneyBag', 'Brick\\Money\\Exception\\X'],
      ],
      excludeFqcns: new Set(['Brick\\Money\\Money', 'Brick\\Money\\Exception\\X']),
    });

    expect(glossary.map((entry) => entry.fqcn)).toEqual(['Brick\\Money\\Currency', 'Brick\\Money\\MoneyBag']);
  });

  it('conserva dos FQCN distintos con el mismo nombre corto (no inventa ni fusiona)', () => {
    const glossary = buildPhpFqcnGlossary({
      importGroups: [['A\\Context'], ['B\\Context']],
      excludeFqcns: new Set(),
    });

    expect(glossary.map((entry) => entry.fqcn)).toEqual(['A\\Context', 'B\\Context']);
  });

  it('tope por defecto de 30 entradas y tope configurable', () => {
    const imports = Array.from({ length: 45 }, (_, i) => `Vendor\\Pkg\\Type${i}`);

    expect(MAX_PHP_FQCN_GLOSSARY_ENTRIES).toBe(30);
    expect(buildPhpFqcnGlossary({ importGroups: [imports], excludeFqcns: new Set() })).toHaveLength(30);
    expect(buildPhpFqcnGlossary({ importGroups: [imports], excludeFqcns: new Set() }).at(-1)?.fqcn).toBe('Vendor\\Pkg\\Type29');
    expect(buildPhpFqcnGlossary({ importGroups: [imports], excludeFqcns: new Set(), maxEntries: 3 })).toHaveLength(3);
  });

  it('excluye los FQCN de un solo segmento (clases globales de PHP)', () => {
    expect(
      buildPhpFqcnGlossary({
        importGroups: [['DateTimeImmutable', '\\Exception', 'Brick\\Money\\Context\\AutoContext']],
        excludeFqcns: new Set(),
      }),
    ).toEqual([{ typeName: 'AutoContext', fqcn: 'Brick\\Money\\Context\\AutoContext' }]);
    expect(buildPhpFqcnGlossary({ importGroups: [['DateTimeImmutable', 'Exception']], excludeFqcns: new Set() })).toEqual([]);
  });

  it('sin imports no se inventa nada; descarta valores que no son FQCN (p. ej. restos de `use function`)', () => {
    expect(buildPhpFqcnGlossary({ importGroups: [], excludeFqcns: new Set() })).toEqual([]);
    expect(buildPhpFqcnGlossary({ importGroups: [[], []], excludeFqcns: new Set() })).toEqual([]);
    expect(
      buildPhpFqcnGlossary({
        importGroups: [['Foo\\function bar', 'function strlen', '', ' ', './module.js', 'Valid\\Name']],
        excludeFqcns: new Set(),
      }),
    ).toEqual([{ typeName: 'Name', fqcn: 'Valid\\Name' }]);
  });

  it('nunca lanza con entradas inválidas', () => {
    expect(buildPhpFqcnGlossary({ importGroups: [[undefined as unknown as string]], excludeFqcns: new Set() })).toEqual([]);
    expect(buildPhpFqcnGlossary({ importGroups: undefined as never, excludeFqcns: new Set() })).toEqual([]);
  });
});

describe('renderPhpFqcnGlossary (WI-CORE-104)', () => {
  it('encabezado y líneas «- Nombre → FQCN»; vacío sin entradas', () => {
    expect(renderPhpFqcnGlossary([])).toBe('');
    expect(renderPhpFqcnGlossary([{ typeName: 'AutoContext', fqcn: 'Brick\\Money\\Context\\AutoContext' }])).toBe(
      `${GLOSSARY_HEADER}\n- AutoContext → Brick\\Money\\Context\\AutoContext`,
    );
  });
});

describe('composePhpDependencySection (WI-CORE-104, R2b)', () => {
  it('sin glosario devuelve la base tal cual (y null si no había base)', () => {
    const base = section([dependency()]);

    expect(composePhpDependencySection(base, [])).toBe(base);
    expect(composePhpDependencySection(null, [])).toBeNull();
  });

  it('con base null y glosario crea la sección con entries vacío y unresolvedCount 0', () => {
    const glossary = [{ typeName: 'AutoContext', fqcn: 'Brick\\Money\\Context\\AutoContext' }];

    const composed = composePhpDependencySection(null, glossary);

    expect(composed).toEqual({
      entries: [],
      transitiveEntries: [],
      unresolvedCount: 0,
      truncated: false,
      tokenCount: countPhpDependencyTokens(renderPhpFqcnGlossary(glossary)),
      text: renderPhpFqcnGlossary(glossary),
    });
    expect(composed?.tokenCount).toBeGreaterThan(0);
  });

  it('renderiza primero las dependencias (con R2a) y después el glosario, con tokenCount del texto completo', () => {
    const base = section(
      [
        dependency({ final: true, constructorVisibility: 'private', factories: ['of(int $a): static', 'zero(): static'] }),
        dependency({ typeName: 'Plan', fqcn: 'D\\Plan', via: 'Money', signature: '(int $x)' }),
      ],
      { unresolvedCount: 2, truncated: false },
    );
    const glossary = [{ typeName: 'AutoContext', fqcn: 'Brick\\Money\\Context\\AutoContext' }];

    const composed = composePhpDependencySection(base, glossary);

    expect(composed?.text).toBe(`${base.text}\n\n${renderPhpFqcnGlossary(glossary)}`);
    expect(composed?.text).toContain('constructor privado: no uses new; fábricas públicas: of(int $a): static, zero(): static');
    expect(composed?.text).toContain('- AutoContext → Brick\\Money\\Context\\AutoContext');
    expect(composed?.tokenCount).toBe(countPhpDependencyTokens(composed?.text ?? ''));
    expect(composed?.entries.map((e) => e.typeName)).toEqual(['Money']);
    expect(composed?.transitiveEntries.map((e) => e.typeName)).toEqual(['Plan']);
    expect(composed?.unresolvedCount).toBe(2);
    expect(composed?.truncated).toBe(false);
  });

  it('cabe en 500 tokens: recorta primero el glosario desde la última entrada y marca truncated', () => {
    const base = section([dependency({ final: true, constructorVisibility: 'private', factories: ['of(int $a): static'] })]);
    const glossary = makeGlossary(30);
    const baseTokens = base.tokenCount;
    // Tope que admite la base más un trozo del glosario.
    const cap = baseTokens + countPhpDependencyTokens(renderPhpFqcnGlossary(glossary.slice(0, 5))) + 2;

    const composed = composePhpDependencySection(base, glossary, cap);

    expect(composed?.truncated).toBe(true);
    expect(composed?.tokenCount).toBeLessThanOrEqual(cap);
    // Las entradas y las fábricas de la base siguen intactas.
    expect(composed?.text).toContain('fábricas públicas: of(int $a): static');
    const lines = composed?.text.split('\n').filter((line) => line.includes('Vendor\\Pkg\\Type')) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(30);
    // Se recorta desde la última: lo que queda es un prefijo.
    expect(lines).toEqual(glossary.slice(0, lines.length).map((g) => `- ${g.typeName} → ${g.fqcn}`));
  });

  it('con el tope por defecto (500) un glosario de 30 que no cabe se recorta y el tokenCount no pasa de 500', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({
      typeName: `VeryLongTypeNameNumber${i}`,
      fqcn: `Some\\Quite\\Long\\Vendor\\Namespace\\Segment\\Another\\Segment\\VeryLongTypeNameNumber${i}`,
    }));

    const composed = composePhpDependencySection(null, long);

    expect(countPhpDependencyTokens(renderPhpFqcnGlossary(long))).toBeGreaterThan(500);
    expect(composed?.truncated).toBe(true);
    expect(composed?.tokenCount).toBeLessThanOrEqual(500);
    expect(composed?.tokenCount).toBeGreaterThan(460);
  });

  it('orden de recorte: glosario, luego fábricas, luego firmas, luego entradas', () => {
    const factories = Array.from({ length: 4 }, (_, i) => `build${i}(${Array.from({ length: 10 }, (_, j) => `int $p${j}`).join(', ')}): static`);
    const signature = `(${Array.from({ length: 30 }, (_, j) => `int $s${j}`).join(', ')})`;
    const base = section([
      dependency({ typeName: 'A', fqcn: 'N\\A', constructorVisibility: 'private', factories }),
      dependency({ typeName: 'B', fqcn: 'N\\B', signature }),
    ]);
    const glossary = makeGlossary(10);
    const tokensWith = (entries: PhpDependencyEntry[], g: PhpFqcnGlossaryEntry[]) =>
      countPhpDependencyTokens(
        [renderPhpDependencySection(entries), renderPhpFqcnGlossary(g)].filter((part) => part !== '').join('\n\n'),
      );
    const [a, b] = base.entries;

    // 1) cabe sin el glosario: se pierde todo el glosario y nada más.
    const noGlossary = composePhpDependencySection(base, glossary, tokensWith([a, b], []));
    expect(noGlossary?.text).not.toContain(GLOSSARY_HEADER);
    expect(noGlossary?.entries[0].factories).toEqual(factories);
    expect(noGlossary?.entries[1].signature).toBe(signature);
    expect(noGlossary?.truncated).toBe(true);

    // 2) no cabe sin fábricas: se retiran las fábricas pero se conserva el aviso y la firma de B.
    const noFactories = composePhpDependencySection(base, glossary, tokensWith([{ ...a, factories: [] }, b], []));
    expect(noFactories?.entries[0].factories).toEqual([]);
    expect(noFactories?.text).toContain('- A → N\\A (constructor) — constructor privado: no uses new\n');
    expect(noFactories?.entries[1].signature).toBe(signature);

    // 3) no cabe con la firma de B: se retira la firma pero se conserva B.
    const noSignature = composePhpDependencySection(
      base,
      glossary,
      tokensWith([{ ...a, factories: [] }, { ...b, signature: undefined }], []),
    );
    expect(noSignature?.entries.map((e) => e.typeName)).toEqual(['A', 'B']);
    expect(noSignature?.entries[1].signature).toBeUndefined();
    expect(noSignature?.entries[0].factories).toEqual([]);

    // 4) no cabe con B: se retira la última entrada.
    const noEntryB = composePhpDependencySection(base, glossary, tokensWith([{ ...a, factories: [] }], []));
    expect(noEntryB?.entries.map((e) => e.typeName)).toEqual(['A']);
  });

  it('con base y glosario recortado entero conserva la base y marca truncated', () => {
    const base = section([dependency()]);

    const composed = composePhpDependencySection(base, makeGlossary(3), base.tokenCount);

    expect(composed?.text).toBe(base.text);
    expect(composed?.truncated).toBe(true);
  });

  it('sin base y con todo el glosario recortado devuelve null', () => {
    expect(composePhpDependencySection(null, makeGlossary(3), 1)).toBeNull();
  });

  it('arrastra truncated de la base', () => {
    const base = section([dependency()], { truncated: true });

    expect(composePhpDependencySection(base, makeGlossary(1))?.truncated).toBe(true);
  });
});
