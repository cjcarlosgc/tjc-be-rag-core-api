// WI-CORE-107: paridad de las copias locales del CLI OE2 frente a la lógica del producto. Si el producto cambia y la
// copia no se actualiza, estas pruebas fallan. Sin base de datos ni red.
import { describe, expect, it } from 'vitest';
import { RetrievalService } from '../../src/retrieval/retrieval.service.js';
import { ContextBuilder } from '../../src/retrieval/context-builder.service.js';
import { computeRetrievalMetrics as productComputeRetrievalMetrics } from '../../src/retrieval-comparisons/retrieval-comparison-metrics.js';
import {
  rankComparisonCandidates as productRankComparisonCandidates,
  symbolQualifiedNameOf as productSymbolQualifiedNameOf,
} from '../../src/retrieval-comparisons/retrieval-comparison-ranking.js';
import {
  INDEXING_IGNORED_DIRS as productIgnoredDirs,
  isIgnoredPath as productIsIgnoredPath,
  isTestFile as productIsTestFile,
} from '../../src/project-versions/indexing.constants.js';
import { RetrievalComparisonJobHandler, SEMANTIC_TOP_K as productSemanticTopK } from '../../src/retrieval-comparisons/retrieval-comparison-job.handler.js';
import { COMPARISON_FINAL_TOP_K as productFinalTopK } from '../../src/retrieval-comparisons/retrieval-comparison-ranking.js';
import { DEFAULT_VECTOR_TOP_K as productDefaultVectorTopK } from '../../src/retrieval/retrieval.service.js';
import {
  COMPARISON_FINAL_TOP_K,
  FROZEN_SEMANTIC_WEIGHT,
  FROZEN_STRUCTURAL_WEIGHT,
  INDEXING_IGNORED_DIRS,
  SEMANTIC_TOP_K,
  combinedScoreOf,
  computeRetrievalMetrics,
  fullyQualifiedMentionRegex,
  isIgnoredPath,
  isTestFile,
  rankComparisonCandidates,
  shortNameMentionRegex,
  symbolQualifiedNameOf,
} from './product-copies.mjs';

/** Generador determinista de casos (no criptográfico) para los barridos de paridad. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const PATHS = [
  'src/A.php', 'src/Nested/B.php', 'tests/Unit/CTest.php', 'app/FooTest.php', 'app/Foo.test.ts', 'app/Foo.spec.tsx',
  'vendor/x/y.php', 'node_modules/a/b.ts', 'src/build/c.php', 'src/Storage/x.php', 'Contest.php', 'lib/tests.php',
  'src/cache/a.ts', 'dist/out.js', '.git/config', 'pkg/.next/x.ts',
];

describe('isTestFile e isIgnoredPath (paridad con indexing.constants)', () => {
  it.each(PATHS.map((path) => [path]))('coincide con el producto para %s', (path) => {
    expect(isTestFile(path)).toBe(productIsTestFile(path));
    expect(isIgnoredPath(path)).toBe(productIsIgnoredPath(path));
  });
});

describe('symbolQualifiedNameOf (paridad)', () => {
  const cases = [
    { symbolName: 'amount', parentSymbolName: 'App\\Money' },
    { symbolName: 'format', parentSymbolName: null },
    { symbolName: null, parentSymbolName: 'App\\Money' },
    { symbolName: null, parentSymbolName: null },
  ];
  it.each(cases.map((chunk) => [chunk]))('coincide con el producto para %j', (chunk) => {
    expect(symbolQualifiedNameOf(chunk)).toBe(productSymbolQualifiedNameOf(chunk));
  });
});

describe('computeRetrievalMetrics (paridad)', () => {
  it('coincide con el producto en 300 casos aleatorios, incluidos símbolos repetidos y GT vacía', () => {
    const random = lcg(7);
    for (let caseIndex = 0; caseIndex < 300; caseIndex += 1) {
      const size = Math.floor(random() * 14);
      const ranked = Array.from({ length: size }, (_, index) => ({
        rank: index + 1,
        filePath: `f${Math.floor(random() * 4)}.php`,
        symbolQualifiedName: random() < 0.1 ? null : `S${Math.floor(random() * 6)}`,
      }));
      const truthSize = Math.floor(random() * 5);
      const truth = Array.from({ length: truthSize }, () => ({
        filePath: `f${Math.floor(random() * 4)}.php`,
        symbolQualifiedName: `S${Math.floor(random() * 6)}`,
      }));
      expect(computeRetrievalMetrics(ranked, truth)).toEqual(productComputeRetrievalMetrics(ranked, truth));
    }
  });

  it('devuelve null sin verdad de terreno, como el producto', () => {
    expect(computeRetrievalMetrics([], null)).toBeNull();
    expect(computeRetrievalMetrics([], [])).toBeNull();
    expect(productComputeRetrievalMetrics([], [])).toBeNull();
  });
});

describe('rankComparisonCandidates (paridad)', () => {
  const weights = { semanticWeight: 0.7, structuralWeight: 0.3 };
  const productScore = (candidate: { semanticScore: number | null; structuralMatch: string | null }) =>
    ContextBuilder.prototype.scoreCandidate.call(null as never, weights, candidate.semanticScore, candidate.structuralMatch as never);
  const localScore = (candidate: { semanticScore: number | null; structuralMatch: string | null }) =>
    combinedScoreOf(weights, candidate.semanticScore, candidate.structuralMatch as never);

  it('la fórmula combinada coincide bit a bit con ContextBuilder.scoreCandidate', () => {
    const random = lcg(11);
    for (let index = 0; index < 200; index += 1) {
      const semantic = random() < 0.2 ? null : random();
      const structural = random() < 0.5 ? 'IMPORTS' : null;
      expect(combinedScoreOf(weights, semantic, structural as never)).toBe(
        productScore({ semanticScore: semantic, structuralMatch: structural }),
      );
    }
  });

  it('coincide con el producto en SE y SEM sobre 200 conjuntos aleatorios con empates', () => {
    const random = lcg(23);
    const relations = [null, 'IMPORTS', 'IMPORTED_BY', 'SAME_NAMESPACE', 'FULLY_QUALIFIED_REFERENCE', 'DECLARING_CLASS'];
    for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
      const size = 1 + Math.floor(random() * 25);
      const candidates = Array.from({ length: size }, (_, index) => {
        const semantic = random() < 0.25 ? null : Math.round(random() * 4) / 4;
        const structural = relations[Math.floor(random() * relations.length)];
        return {
          chunk: {
            id: `c${Math.floor(random() * 40)}-${index}`,
            filePath: `f${Math.floor(random() * 3)}.php`,
            symbolName: random() < 0.1 ? null : `m${Math.floor(random() * 5)}`,
            parentSymbolName: random() < 0.5 ? 'App\\K' : null,
          },
          semanticScore: semantic,
          structuralMatch: semantic === null && structural === null ? 'IMPORTS' : structural,
        };
      });
      const withoutDuplicateIds = candidates.filter((item, index) => candidates.findIndex((other) => other.chunk.id === item.chunk.id) === index);
      for (const mode of ['SE', 'SEM'] as const) {
        const productRanked = productRankComparisonCandidates(withoutDuplicateIds as never, mode, productScore as never);
        const localRanked = rankComparisonCandidates(withoutDuplicateIds as never, mode, localScore as never);
        expect(localRanked).toEqual(productRanked);
      }
    }
  });
});

describe('regex de menciones R-PHP3 y R-PHP4 (paridad con RetrievalService)', () => {
  const service = RetrievalService.prototype as unknown as {
    classifyPhpRelation: (chunk: unknown, context: unknown) => string | null;
  };
  const chunk = { symbolKind: 'METHOD', symbolName: 'x', importsUsed: [], filePath: 'src/a.php' };
  const classify = (owner: string, content: string, anchorClass: string) =>
    service.classifyPhpRelation.call({}, chunk, {
      anchorClass,
      anchorNamespace: anchorClass.slice(0, Math.max(0, anchorClass.lastIndexOf('\\'))),
      anchorImports: new Set<string>(),
      anchorContent: content,
      owner,
    });

  const contents = [
    'public function a(Money $m): Money { return $m; }',
    'new \\App\\Domain\\Money();',
    'new \\App\\Domain\\MoneyBag();',
    'use App\\Domain\\Money; $x = Money::zero();',
    'no mention here',
    'Moneyish Money_ $Money \\App\\Domain\\Money. \\App\\Domain\\Money_x',
  ];
  const owners = ['App\\Domain\\Money', 'App\\Domain\\MoneyBag', 'App\\Other\\Money', 'Money'];

  it('SAME_NAMESPACE coincide con shortNameMentionRegex del producto', () => {
    for (const owner of owners) {
      for (const content of contents) {
        const product = classify(owner, content, 'App\\Domain\\Anchor') === 'SAME_NAMESPACE';
        const namespaceOk = owner.lastIndexOf('\\') >= 0 && owner.slice(0, owner.lastIndexOf('\\')) === 'App\\Domain';
        const local = namespaceOk && shortNameMentionRegex(owner).test(content);
        // R-PHP3 del producto exige `owner !== anchorClass` y misma namespace; ambos se cumplen aquí.
        expect(local, `${owner} | ${content}`).toBe(product);
      }
    }
  });

  it('FULLY_QUALIFIED_REFERENCE coincide con fullyQualifiedMentionRegex del producto', () => {
    for (const owner of owners) {
      for (const content of contents) {
        const product = classify(owner, content, 'App\\Other\\Anchor') === 'FULLY_QUALIFIED_REFERENCE';
        const local = fullyQualifiedMentionRegex(owner).test(content);
        expect(local, `${owner} | ${content}`).toBe(product);
      }
    }
  });
});

describe('constantes congeladas frente al producto (M-3)', () => {
  it('SEMANTIC_TOP_K y COMPARISON_FINAL_TOP_K de la copia coinciden con el producto', () => {
    expect(SEMANTIC_TOP_K).toBe(productSemanticTopK);
    expect(COMPARISON_FINAL_TOP_K).toBe(productFinalTopK);
  });

  it('el top-K vectorial congelado coincide con DEFAULT_VECTOR_TOP_K del producto (valor por defecto del retrieval)', () => {
    // La comparación usa SEMANTIC_TOP_K como top-K vectorial; el protocolo lo fija igual al por defecto del producto.
    expect(SEMANTIC_TOP_K).toBe(productDefaultVectorTopK);
  });

  it('los pesos congelados coinciden con los pesos por defecto del producto (observados con resolveWeights)', () => {
    // DEFAULT_SEMANTIC_WEIGHT y DEFAULT_STRUCTURAL_WEIGHT no se exportan: se observan con el ConfigService sin override.
    const weights = ContextBuilder.prototype.resolveWeights.call({ configService: { get: (_key: string, fallback: number) => fallback } } as never);
    expect(weights.semanticWeight).toBe(FROZEN_SEMANTIC_WEIGHT);
    expect(weights.structuralWeight).toBe(FROZEN_STRUCTURAL_WEIGHT);
  });

  it('la configuración que persiste el job de comparación (computeResults) coincide con la congelada', async () => {
    const calls: unknown[][] = [];
    const contextBuilder = {
      resolveWeights: () => ContextBuilder.prototype.resolveWeights.call({ configService: { get: (_key: string, fallback: number) => fallback } } as never),
      scoreCandidate: (...args: unknown[]) => (ContextBuilder.prototype.scoreCandidate as (...values: unknown[]) => number).apply(null, args),
    };
    const stub = {
      retrievalService: {
        retrieve: async (...args: unknown[]) => {
          calls.push(args);
          return { targetChunks: [], candidates: [] };
        },
      },
      contextBuilder,
      configService: { get: (_key: string, fallback: unknown) => fallback },
    };
    const computeResults = (RetrievalComparisonJobHandler.prototype as unknown as {
      computeResults: (projectVersionId: string, target: unknown, groundTruth: unknown) => Promise<Array<{ mode: string; config: Record<string, unknown> }>>;
    }).computeResults;
    const results = await computeResults.call(stub, 'pv-1', { targetType: 'FUNCTION', symbolName: 'f', filePath: 'a.php' }, null);
    const se = results.find((result) => result.mode === 'SE');
    const sem = results.find((result) => result.mode === 'SEM');
    expect(calls[0][2]).toBe(SEMANTIC_TOP_K);
    expect(se?.config).toMatchObject({
      semanticTopK: SEMANTIC_TOP_K,
      finalTopK: COMPARISON_FINAL_TOP_K,
      semanticWeight: FROZEN_SEMANTIC_WEIGHT,
      structuralWeight: FROZEN_STRUCTURAL_WEIGHT,
    });
    expect(sem?.config).toMatchObject({
      semanticTopK: SEMANTIC_TOP_K,
      finalTopK: COMPARISON_FINAL_TOP_K,
      semanticWeight: null,
      structuralWeight: null,
    });
  });

  it('INDEXING_IGNORED_DIRS de la copia es exactamente el conjunto del producto', () => {
    expect([...INDEXING_IGNORED_DIRS].sort()).toEqual([...productIgnoredDirs].sort());
  });
});
