import { describe, expect, it } from 'vitest';
import {
  capPhpDependencySection,
  composePhpDependencySection,
  countPhpDependencyTokens,
  MAX_PHP_DEPENDENCY_TOKENS,
  renderPhpAbstractObligationLines,
  renderPhpDependencySection,
  resolvePhpTypeName,
  type PhpDependencyEntry,
  type PhpDependencySection,
  type PhpFqcnGlossaryEntry,
} from './php-dependency-context.js';

const OBLIGATIONS_HEADER = 'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos):';
const UNCERTAIN_HEADER =
  'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos; la jerarquía no se conoce por completo —trait o tipo fuera del índice—: la lista puede ser incompleta o incluir alguno ya implementado):';
const GLOSSARY_HEADER = 'Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:';

function entry(index: number, overrides: Partial<PhpDependencyEntry> = {}): PhpDependencyEntry {
  return {
    typeName: `Service${index}`,
    fqcn: `Acme\\Billing\\Service${index}`,
    origin: 'CONSTRUCTOR',
    resolvedBy: 'IMPORT',
    ...overrides,
  };
}

function glossary(count: number): PhpFqcnGlossaryEntry[] {
  return Array.from({ length: count }, (_, index) => ({ typeName: `Helper${index}`, fqcn: `Acme\\Helpers\\Helper${index}` }));
}

function obligations(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Contract::operation${index}(string $argument, int $other = 0): array`);
}

describe('resolvePhpTypeName (WI-CORE-106)', () => {
  const knownTypes = new Set(['Acme\\Storage\\Reader', 'Acme\\Storage\\Local\\Writer', 'Acme\\Contracts\\Closer']);
  const base = { ownerFqcn: 'Acme\\Storage\\Local\\Driver', importsUsed: ['Acme\\Contracts\\Closer'], knownTypes };

  it('resuelve literal con \\, use y mismo namespace solo si el tipo está en el índice', () => {
    expect(resolvePhpTypeName('\\Acme\\Storage\\Reader', base)).toBe('Acme\\Storage\\Reader');
    expect(resolvePhpTypeName('Closer', base)).toBe('Acme\\Contracts\\Closer');
    expect(resolvePhpTypeName('Writer', base)).toBe('Acme\\Storage\\Local\\Writer');
  });

  it('no inventa: mismo namespace fuera del índice, globales de PHP y escalares dan null', () => {
    expect(resolvePhpTypeName('Missing', base)).toBeNull();
    expect(resolvePhpTypeName('Countable', base)).toBeNull();
    expect(resolvePhpTypeName('\\Countable', base)).toBeNull();
    expect(resolvePhpTypeName('int', base)).toBeNull();
    expect(resolvePhpTypeName('', base)).toBeNull();
    expect(resolvePhpTypeName('namespace\\Writer', base)).toBeNull();
    expect(resolvePhpTypeName('NAMESPACE\\Local\\Writer', base)).toBeNull();
    expect(resolvePhpTypeName(undefined as unknown as string, base)).toBeNull();
  });
});

describe('capPhpDependencySection con obligaciones abstractas (WI-CORE-106)', () => {
  it('renderiza dependencias, luego obligaciones y al final el glosario, con tokens del texto completo', () => {
    const lines = ['Contract::open(): void'];
    const capped = capPhpDependencySection([entry(1)], glossary(1), 500, lines);

    expect(capped.text).toBe(
      [
        renderPhpDependencySection([entry(1)]),
        `${OBLIGATIONS_HEADER}\n- Contract::open(): void`,
        `${GLOSSARY_HEADER}\n- Helper0 → Acme\\Helpers\\Helper0`,
      ].join('\n\n'),
    );
    expect(capped.tokenCount).toBe(countPhpDependencyTokens(capped.text));
    expect(capped.truncated).toBe(false);
    expect(capped.abstractObligations).toEqual(lines);
  });

  it('sin obligaciones el texto es exactamente el de antes (sin encabezado)', () => {
    const capped = capPhpDependencySection([entry(1)], glossary(1), 500);

    expect(capped.text).not.toContain(OBLIGATIONS_HEADER);
    expect(capped.abstractObligations).toEqual([]);
    expect(capped.text).toBe(`${renderPhpDependencySection([entry(1)])}\n\n${GLOSSARY_HEADER}\n- Helper0 → Acme\\Helpers\\Helper0`);
    expect(renderPhpAbstractObligationLines([])).toBe('');
  });

  it('al exceder recorta primero el glosario y deja intactas las obligaciones', () => {
    const entries = [entry(1)];
    const lines = obligations(3);
    const withoutGlossary = countPhpDependencyTokens(
      [renderPhpDependencySection(entries), renderPhpAbstractObligationLines(lines)].join('\n\n'),
    );

    const capped = capPhpDependencySection(entries, glossary(10), withoutGlossary + 2, lines);

    expect(capped.abstractObligations).toEqual(lines);
    expect(capped.glossary.length).toBeLessThan(10);
    expect(capped.truncated).toBe(true);
    expect(capped.tokenCount).toBeLessThanOrEqual(withoutGlossary + 2);
  });

  it('recorta las fábricas antes que las obligaciones y las obligaciones antes que firmas y entradas', () => {
    const withFactories = entry(1, {
      constructorVisibility: 'private',
      factories: ['create(): static', 'fromString(string $value): static'],
    });
    const withSignature = entry(2, { signature: '(string $first, int $second, array $third = [])' });
    const lines = obligations(4);
    const full = capPhpDependencySection([withFactories, withSignature], [], 10_000, lines);

    // Un tope que solo cubre quitar las fábricas conserva todas las obligaciones.
    const noFactoriesText = [
      renderPhpDependencySection([{ ...withFactories, factories: [] }, withSignature]),
      renderPhpAbstractObligationLines(lines),
    ].join('\n\n');
    const factoriesOnly = capPhpDependencySection([withFactories, withSignature], [], countPhpDependencyTokens(noFactoriesText), lines);
    expect(factoriesOnly.entries[0].factories).toEqual([]);
    expect(factoriesOnly.entries[1].signature).toBe(withSignature.signature);
    expect(factoriesOnly.abstractObligations).toEqual(lines);
    expect(factoriesOnly.truncated).toBe(true);

    // Un tope que obliga a recortar obligaciones las quita desde la última firma y conserva firmas y entradas.
    const twoLinesText = [
      renderPhpDependencySection([{ ...withFactories, factories: [] }, withSignature]),
      renderPhpAbstractObligationLines(lines.slice(0, 2)),
    ].join('\n\n');
    const someObligations = capPhpDependencySection([withFactories, withSignature], [], countPhpDependencyTokens(twoLinesText), lines);
    expect(someObligations.abstractObligations).toEqual(lines.slice(0, 2));
    expect(someObligations.entries).toHaveLength(2);
    expect(someObligations.entries[1].signature).toBe(withSignature.signature);

    // Un tope más bajo quita todas las obligaciones (y el encabezado) antes de tocar firmas o entradas.
    const noObligationsText = renderPhpDependencySection([{ ...withFactories, factories: [] }, withSignature]);
    const none = capPhpDependencySection([withFactories, withSignature], [], countPhpDependencyTokens(noObligationsText), lines);
    expect(none.abstractObligations).toEqual([]);
    expect(none.text).not.toContain(OBLIGATIONS_HEADER);
    expect(none.entries[1].signature).toBe(withSignature.signature);
    expect(none.entries).toHaveLength(2);
    expect(full.truncated).toBe(false);
  });

  it('solo recorta firmas de constructor, profundidad 2 y entradas cuando ya no quedan obligaciones', () => {
    const entries = [entry(1, { signature: '(string $aaaaaaaa, string $bbbbbbbb)' }), entry(2, { via: 'Service1' })];
    const lines = obligations(2);
    const onlyDirect = renderPhpDependencySection([{ ...entries[0], signature: undefined }]);

    const capped = capPhpDependencySection(entries, [], countPhpDependencyTokens(onlyDirect), lines);

    expect(capped.abstractObligations).toEqual([]);
    expect(capped.entries.map((item) => item.via)).toEqual([undefined]);
    expect(capped.entries[0].signature).toBeUndefined();
    expect(capped.truncated).toBe(true);
  });

  it('con tope 500 y muchas obligaciones nunca supera el tope y marca truncated', () => {
    const entries = Array.from({ length: 8 }, (_, index) => entry(index + 1));
    const capped = capPhpDependencySection(entries, glossary(30), MAX_PHP_DEPENDENCY_TOKENS, obligations(12));

    expect(capped.tokenCount).toBeLessThanOrEqual(MAX_PHP_DEPENDENCY_TOKENS);
    expect(capped.tokenCount).toBe(countPhpDependencyTokens(capped.text));
    expect(capped.truncated).toBe(true);
    expect(capped.glossary.length).toBeLessThan(30);
  });

  it('si el recorte afecta solo a las obligaciones, truncated es true; si no se recorta nada, false', () => {
    const entries = [entry(1)];
    const lines = obligations(5);
    const fullText = [renderPhpDependencySection(entries), renderPhpAbstractObligationLines(lines)].join('\n\n');
    const fullTokens = countPhpDependencyTokens(fullText);

    const untouched = capPhpDependencySection(entries, [], fullTokens, lines);
    expect(untouched.abstractObligations).toEqual(lines);
    expect(untouched.truncated).toBe(false);

    const trimmed = capPhpDependencySection(entries, [], fullTokens - 1, lines);
    expect(trimmed.abstractObligations).toEqual(lines.slice(0, 4));
    expect(trimmed.entries).toHaveLength(1);
    expect(trimmed.truncated).toBe(true);
  });

  it('con jerarquía incierta el encabezado con aviso cuenta en los tokens y en el recorte, y desaparece con las firmas', () => {
    const lines = obligations(2);
    const certain = capPhpDependencySection([], [], 500, lines, false);
    const uncertain = capPhpDependencySection([], [], 500, lines, true);

    expect(uncertain.text.startsWith(UNCERTAIN_HEADER)).toBe(true);
    expect(certain.text.startsWith(OBLIGATIONS_HEADER)).toBe(true);
    expect(certain.abstractObligationsUncertain).toBe(false);
    expect(uncertain.abstractObligationsUncertain).toBe(true);
    expect(uncertain.tokenCount).toBe(countPhpDependencyTokens(uncertain.text));
    expect(uncertain.tokenCount).toBeGreaterThan(certain.tokenCount);

    // Un tope que cabe sin firmas pero no con el encabezado de aviso elimina el bloque entero.
    const none = capPhpDependencySection([], [], countPhpDependencyTokens(UNCERTAIN_HEADER) - 1, lines, true);
    expect(none.abstractObligations).toEqual([]);
    expect(none.abstractObligationsUncertain).toBe(false);
    expect(none.text).toBe('');
    expect(none.truncated).toBe(true);

    // Un tope que deja una sola firma con el aviso presente recorta desde la última.
    const oneLine = [UNCERTAIN_HEADER, `- ${lines[0]}`].join('\n');
    const one = capPhpDependencySection([], [], countPhpDependencyTokens(oneLine), lines, true);
    expect(one.abstractObligations).toEqual([lines[0]]);
    expect(one.text).toBe(oneLine);
  });

  it('con 12 obligaciones que caben no activa truncated', () => {
    const capped = capPhpDependencySection([], [], MAX_PHP_DEPENDENCY_TOKENS, obligations(12));

    expect(capped.abstractObligations).toHaveLength(12);
    expect(capped.tokenCount).toBeLessThanOrEqual(MAX_PHP_DEPENDENCY_TOKENS);
    expect(capped.truncated).toBe(false);
  });
});

describe('composePhpDependencySection con obligaciones abstractas (WI-CORE-106)', () => {
  function sectionWith(lines: string[], overrides: Partial<PhpDependencySection> = {}): PhpDependencySection {
    const capped = capPhpDependencySection([], [], 500, lines);
    return {
      entries: [],
      transitiveEntries: [],
      unresolvedCount: 0,
      truncated: false,
      tokenCount: capped.tokenCount,
      text: capped.text,
      abstractObligations: lines,
      ...overrides,
    };
  }

  it('compone el glosario sobre una sección de solo obligaciones sin perderlas y en el orden definido', () => {
    const lines = ['Contract::open(): void'];

    const composed = composePhpDependencySection(sectionWith(lines), glossary(2));

    expect(composed?.abstractObligations).toEqual(lines);
    expect(composed?.entries).toEqual([]);
    expect(composed?.text).toBe(
      `${OBLIGATIONS_HEADER}\n- Contract::open(): void\n\n${GLOSSARY_HEADER}\n- Helper0 → Acme\\Helpers\\Helper0\n- Helper1 → Acme\\Helpers\\Helper1`,
    );
    expect(composed?.tokenCount).toBe(countPhpDependencyTokens(composed?.text ?? ''));
  });

  it('conserva el aviso de jerarquía incierta al componer con el glosario', () => {
    const lines = ['Contract::open(): void'];
    const capped = capPhpDependencySection([], [], 500, lines, true);
    const base: PhpDependencySection = {
      entries: [],
      transitiveEntries: [],
      unresolvedCount: 0,
      truncated: false,
      tokenCount: capped.tokenCount,
      text: capped.text,
      abstractObligations: lines,
      abstractObligationsUncertain: true,
    };

    const composed = composePhpDependencySection(base, glossary(1));

    expect(composed?.abstractObligationsUncertain).toBe(true);
    expect(composed?.text.startsWith(UNCERTAIN_HEADER)).toBe(true);
    expect(composed?.text).toContain(GLOSSARY_HEADER);
  });

  it('sin glosario devuelve la misma sección', () => {
    const base = sectionWith(['Contract::open(): void']);

    expect(composePhpDependencySection(base, [])).toBe(base);
  });

  it('con tope bajo el glosario se recorta antes que las obligaciones', () => {
    const lines = obligations(3);
    const base = sectionWith(lines);

    const composed = composePhpDependencySection(base, glossary(10), base.tokenCount + 3);

    expect(composed?.abstractObligations).toEqual(lines);
    expect(composed?.truncated).toBe(true);
    expect(composed?.tokenCount).toBeLessThanOrEqual(base.tokenCount + 3);
  });
});
