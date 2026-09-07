/**
 * Serializa `value` a JSON con las keys de cada objeto ordenadas
 * recursivamente, para que dos requests lógicamente idénticos (mismos
 * campos, distinto orden de inserción) produzcan la misma huella hash. Los
 * arrays conservan su orden (es significativo); una key con valor
 * `undefined` se omite igual que `JSON.stringify` (no se normaliza a
 * `null`), preservando la distinción entre "campo omitido" y "campo null".
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }

  return value;
}
