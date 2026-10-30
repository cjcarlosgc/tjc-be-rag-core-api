// WI-CORE-107: fixtures SINTÉTICOS para las pruebas del CLI OE2. Son PHP inventado, sin relación con ningún repositorio
// de piloto ni con datos reales. No se usan fuera de las pruebas.
import { sha256Hex } from '../evidence-extractor/util.mjs';

/** Construye un chunk del volcado con su `contentSha256`. Los campos siguen la especificación de `chunks.jsonl`. */
export function chunk({
  filePath,
  symbolKind,
  symbolName = null,
  parentSymbolName = null,
  content,
  partIndex = 1,
  partsTotal = 1,
  importsUsed = [],
  startLine = 1,
}) {
  return {
    filePath,
    symbolKind,
    symbolName,
    parentSymbolName,
    startLine,
    endLine: startLine + content.split('\n').length - 1,
    partIndex,
    partsTotal,
    importsUsed,
    tokenCount: null,
    contentSha256: sha256Hex(content),
    content,
  };
}

/**
 * Volcado sintético. Símbolos elegibles: `App\Domain\Converter::convert` (cierre Money y Rate), `App\Domain\Rate::apply`
 * (cierre Money y App\Other\Thing) y `App\Util\format` (cierre Money). El resto cae en motivos de no elegibilidad.
 */
export function syntheticChunks() {
  const chunks = [];
  const add = (options) => chunks.push(chunk(options));

  add({
    filePath: 'src/Domain/Converter.php', symbolKind: 'CLASS', symbolName: 'App\\Domain\\Converter',
    content: 'final class Converter {\n    public function convert(Money $m): Money { return $m; }\n}\n',
  });
  add({
    filePath: 'src/Domain/Converter.php', symbolKind: 'METHOD', symbolName: 'convert',
    parentSymbolName: 'App\\Domain\\Converter', startLine: 2,
    importsUsed: ['App\\Domain\\Money'],
    content: '    public function convert(Money $m): Money\n    {\n        return \\App\\Domain\\Rate::unit()->apply($m);\n    }\n',
  });
  add({
    filePath: 'src/Domain/Converter.php', symbolKind: 'METHOD', symbolName: 'label',
    parentSymbolName: 'App\\Domain\\Converter', startLine: 6,
    content: '    public function label(): string\n    {\n        return "converter";\n    }\n',
  });

  add({
    filePath: 'src/Domain/Money.php', symbolKind: 'CLASS', symbolName: 'App\\Domain\\Money',
    content: 'final class Money {}\n',
  });
  add({
    filePath: 'src/Domain/Money.php', symbolKind: 'METHOD', symbolName: 'amount',
    parentSymbolName: 'App\\Domain\\Money', startLine: 2,
    content: '    public function amount(): int\n    {\n        return $this->cents;\n    }\n',
  });
  add({
    filePath: 'src/Domain/Money.php', symbolKind: 'CONSTRUCTOR', symbolName: 'constructor',
    parentSymbolName: 'App\\Domain\\Money', startLine: 6,
    content: '    public function __construct(int $cents) { $this->cents = $cents; }\n',
  });

  add({
    filePath: 'src/Domain/Rate.php', symbolKind: 'CLASS', symbolName: 'App\\Domain\\Rate',
    content: 'class Rate {}\n',
  });
  add({
    filePath: 'src/Domain/Rate.php', symbolKind: 'METHOD', symbolName: 'apply',
    parentSymbolName: 'App\\Domain\\Rate', startLine: 2,
    importsUsed: ['App\\Other\\Thing'],
    content: '    public function apply(Money $m): Money\n    {\n        $shipping = new \\App\\Other\\Thing();\n        return $m;\n    }\n',
  });
  add({
    filePath: 'src/Domain/Rate.php', symbolKind: 'METHOD', symbolName: 'big',
    parentSymbolName: 'App\\Domain\\Rate', startLine: 8, partIndex: 1, partsTotal: 2,
    content: '    public function big(): void\n    {\n',
  });

  add({
    filePath: 'src/Other/Thing.php', symbolKind: 'CLASS', symbolName: 'App\\Other\\Thing',
    content: 'class Thing {}\n',
  });

  add({
    filePath: 'src/Util/format.php', symbolKind: 'FUNCTION', symbolName: 'App\\Util\\format',
    content: 'function format(\\App\\Domain\\Money $m): string\n{\n    return (string) $m;\n}\n',
  });
  add({
    filePath: 'src/Util/total.php', symbolKind: 'FUNCTION', symbolName: 'App\\Util\\total',
    content: "function total(array $items = ['a;b{']): int\n{\n    return count($items);\n}\n",
  });

  add({
    filePath: 'src/Contracts/Priced.php', symbolKind: 'INTERFACE', symbolName: 'App\\Contracts\\Priced',
    content: 'interface Priced {}\n',
  });
  add({
    filePath: 'src/Contracts/Priced.php', symbolKind: 'METHOD', symbolName: 'price',
    parentSymbolName: 'App\\Contracts\\Priced', startLine: 2,
    content: '    public function price(): int;\n',
  });

  add({
    filePath: 'src/Domain/Base.php', symbolKind: 'CLASS', symbolName: 'App\\Domain\\Base',
    content: 'abstract class Base {}\n',
  });
  add({
    filePath: 'src/Domain/Base.php', symbolKind: 'METHOD', symbolName: 'template',
    parentSymbolName: 'App\\Domain\\Base', startLine: 2,
    content: '    abstract protected function template(Money $m): Money;\n',
  });

  add({
    filePath: 'tests/Unit/ConverterTest.php', symbolKind: 'CLASS', symbolName: 'Tests\\Unit\\ConverterTest',
    content: 'class ConverterTest {}\n',
  });
  add({
    filePath: 'tests/Unit/ConverterTest.php', symbolKind: 'METHOD', symbolName: 'testConvert',
    parentSymbolName: 'Tests\\Unit\\ConverterTest', startLine: 2,
    content: '    public function testConvert(): void { $this->assertTrue(true); }\n',
  });

  add({
    filePath: 'vendor/acme/lib/Lib.php', symbolKind: 'METHOD', symbolName: 'run',
    parentSymbolName: 'Acme\\Lib', startLine: 1,
    content: '    public function run(): void { return; }\n',
  });

  return chunks;
}

/** Resumen esperado del volcado sintético: motivo de no elegibilidad por símbolo (METHOD y FUNCTION). */
export const EXPECTED_REASONS = Object.freeze({
  'src/Domain/Converter.php::App\\Domain\\Converter.convert': '',
  'src/Domain/Converter.php::App\\Domain\\Converter.label': 'cierre-vacio',
  'src/Domain/Money.php::App\\Domain\\Money.amount': 'cierre-vacio',
  'src/Domain/Rate.php::App\\Domain\\Rate.apply': '',
  'src/Domain/Rate.php::App\\Domain\\Rate.big': 'partes-incompletas',
  'src/Util/format.php::App\\Util\\format': '',
  'src/Util/total.php::App\\Util\\total': 'cierre-vacio',
  'src/Contracts/Priced.php::App\\Contracts\\Priced.price': 'sin-cuerpo',
  'src/Domain/Base.php::App\\Domain\\Base.template': 'sin-cuerpo',
  'tests/Unit/ConverterTest.php::Tests\\Unit\\ConverterTest.testConvert': 'archivo-de-prueba',
  'vendor/acme/lib/Lib.php::Acme\\Lib.run': 'ruta-ignorada',
});

/** Serializa chunks a texto JSONL con claves ordenadas (como `dump-chunks`). */
export function toJsonl(chunks) {
  return chunks.map((item) => `${JSON.stringify(sortedKeys(item))}\n`).join('');
}

function sortedKeys(value) {
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return sorted;
}

/** Configuración congelada por modo (la misma que el job de comparación persiste). */
export const CONFIG_SE = Object.freeze({
  semanticTopK: 20, finalTopK: 10, semanticWeight: 0.7, structuralWeight: 0.3, embeddingModel: 'text-embedding-3-small',
});
export const CONFIG_SEM = Object.freeze({
  semanticTopK: 20, finalTopK: 10, semanticWeight: null, structuralWeight: null, embeddingModel: 'text-embedding-3-small',
});

/**
 * Candidatos de un modo a partir de especificaciones `{ filePath, qualifiedName, semantic, structural, chunkId }`.
 * Calcula el score combinado con la misma expresión del producto y ordena como el producto: SE por combinado desc,
 * semántico desc y chunkId asc; SEM solo con semántico, por semántico desc y chunkId asc. `selected` si rank <= 10.
 */
export function candidatesFor(specs, mode) {
  const weightsSe = { semanticWeight: 0.7, structuralWeight: 0.3 };
  const items = specs
    .filter((spec) => (mode === 'SEM' ? spec.semantic !== null && spec.semantic !== undefined : true))
    .map((spec) => {
      const semantic = spec.semantic ?? null;
      const structural = mode === 'SE' ? spec.structural ?? null : null;
      const boost = structural ? 1 : 0;
      const combined = mode === 'SE' ? weightsSe.semanticWeight * (semantic ?? 0) + weightsSe.structuralWeight * boost : null;
      return { ...spec, semantic, structural, combined };
    });
  items.sort((a, b) => {
    const orderA = mode === 'SE' ? a.combined : a.semantic;
    const orderB = mode === 'SE' ? b.combined : b.semantic;
    if (orderA !== orderB) return orderB - orderA;
    const semA = a.semantic ?? Number.NEGATIVE_INFINITY;
    const semB = b.semantic ?? Number.NEGATIVE_INFINITY;
    if (semA !== semB) return semA > semB ? -1 : 1;
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });
  return items.map((item, index) => ({
    rank: index + 1,
    chunkId: item.chunkId,
    filePath: item.filePath,
    symbolQualifiedName: item.qualifiedName,
    semanticScore: item.semantic,
    structuralRelation: mode === 'SE' ? item.structural : null,
    combinedScore: mode === 'SE' ? item.combined : null,
    selected: index + 1 <= 10,
  }));
}

/** Documento de comparación tal como lo escribe `dump-results` (sin depender de la base). */
export function comparisonDocument({ id, symbol, specs }) {
  return {
    retrievalComparisonId: id,
    analysisRunId: 'run-oe2',
    projectVersionId: 'pv-oe2',
    symbol: { language: 'PHP', changeKind: 'ADDED', ...symbol },
    modes: [
      { mode: 'SE', retrievalId: `${id}-se`, config: { ...CONFIG_SE }, candidates: candidatesFor(specs, 'SE'), metrics: null },
      { mode: 'SEM', retrievalId: `${id}-sem`, config: { ...CONFIG_SEM }, candidates: candidatesFor(specs, 'SEM'), metrics: null },
    ],
    completedAt: '2026-10-26T12:00:00.000Z',
  };
}

/**
 * Doble del driver de PostgreSQL para las pruebas de los volcados. `dispatch(sql, args)` devuelve `{ columnNames,
 * rows }` o lanza. Registra cada sentencia para comprobar la secuencia de solo lectura.
 */
export function createDriverDouble(dispatch) {
  const log = [];
  const transaction = {
    async executeRaw(query) {
      log.push({ kind: 'executeRaw', sql: query.sql });
      return 0;
    },
    async queryRaw(query) {
      log.push({ kind: 'queryRaw', sql: query.sql, args: query.args });
      return dispatch(query.sql, query.args);
    },
    async rollback() {
      log.push({ kind: 'release' });
    },
  };
  const driver = {
    async startTransaction() {
      log.push({ kind: 'begin' });
      return transaction;
    },
    async dispose() {
      log.push({ kind: 'dispose' });
    },
  };
  return { log, openDriver: () => async () => driver };
}

/** Conjunto de resultados a partir de objetos y la lista de columnas esperada. */
export function resultSet(columns, objects) {
  return { columnNames: columns, columnTypes: [], rows: objects.map((item) => columns.map((column) => item[column])) };
}
