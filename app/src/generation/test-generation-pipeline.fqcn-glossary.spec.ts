import { describe, expect, it, vi } from 'vitest';
import { acquireGenerationContext } from './test-generation-pipeline.js';
import { InsufficientGenerationContextError } from './context-sufficiency.js';
import { PromptBuilder } from './prompt-builder.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { PhpDependencyContextService } from '../retrieval/php-dependency-context.service.js';
import { makeRagDetail } from '../experiments/experiment-attempt-presenters.js';
import type { CodeChunk } from '../generated/prisma/client.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';
import type { RetrievalCandidate } from '../retrieval/retrieval.service.js';

const DECLARING = 'App\\Billing\\Checkout';
const MONEY = 'Brick\\Money\\Money';
const AUTO_CONTEXT = 'Brick\\Money\\Context\\AutoContext';
const TARGET = { filePath: 'src/Checkout.php', symbolName: 'Checkout::pay', methodName: 'pay', targetType: 'METHOD' as const };

function chunk(id: string, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id,
    projectVersionId: 'version-1',
    filePath: `src/${id}.php`,
    symbolKind: 'METHOD',
    symbolName: id,
    parentSymbolName: null,
    startLine: 1,
    endLine: 5,
    content: `// ${id}`,
    importsUsed: [],
    tokenCount: 10,
    partIndex: 1,
    partsTotal: 1,
    createdAt: new Date(0),
    ...overrides,
  } as CodeChunk;
}

const targetChunk = chunk('target', {
  filePath: TARGET.filePath,
  symbolName: 'Checkout::pay',
  parentSymbolName: DECLARING,
  content: 'public function pay(Money $price): void { $this->gateway->charge($price); }',
  importsUsed: [MONEY, 'App\\Billing\\Gateway'],
});

function candidate(id: string, overrides: Partial<CodeChunk>, semanticScore = 0.95): RetrievalCandidate {
  return { chunk: chunk(id, overrides), semanticScore, structuralMatch: null };
}

function makeRepository(factoryError?: Error) {
  const methodRows = [
    { parentSymbolName: MONEY, symbolName: `${MONEY}::zero`, content: 'public static function zero(Currency $c): static {}' },
    { parentSymbolName: MONEY, symbolName: `${MONEY}::of`, content: 'public static function of(int $a, Currency $c): static {}' },
  ];
  return {
    findByFile: vi.fn().mockResolvedValue([
      {
        filePath: TARGET.filePath,
        symbolKind: 'CLASS',
        symbolName: DECLARING,
        parentSymbolName: null,
        importsUsed: [MONEY],
        content: 'class Checkout {}',
      },
      {
        filePath: TARGET.filePath,
        symbolKind: 'CONSTRUCTOR',
        symbolName: '__construct',
        parentSymbolName: DECLARING,
        importsUsed: [MONEY],
        content: 'public function __construct(private Money $price) {}',
      },
    ]),
    findPhpTypeSymbolNames: vi.fn().mockResolvedValue([MONEY, DECLARING]),
    findPhpTypeDeclarations: vi.fn().mockResolvedValue([{ symbolName: MONEY, symbolKind: 'CLASS', content: 'final class Money {}' }]),
    findPhpConstructorDeclarations: vi.fn().mockResolvedValue([
      { parentSymbolName: MONEY, content: 'private function __construct(private string $amount) {}', importsUsed: [] },
    ]),
    findPhpStaticMethodDeclarations: factoryError ? vi.fn().mockRejectedValue(factoryError) : vi.fn().mockResolvedValue(methodRows),
  } as unknown as CodeChunksRepository;
}

function makeSources(options: { candidates?: RetrievalCandidate[]; realDependencies?: boolean; targetChunks?: CodeChunk[] } = {}) {
  const candidates = options.candidates ?? [];
  const contextBuilder = new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as never);
  return {
    retrievalService: { retrieve: vi.fn().mockResolvedValue({ targetChunks: options.targetChunks ?? [targetChunk], candidates }) },
    functionalRulesRetriever: { retrieve: vi.fn().mockResolvedValue([]) },
    phpDependencyContextService: options.realDependencies === false
      ? { resolve: vi.fn().mockResolvedValue(null) }
      : new PhpDependencyContextService(makeRepository()),
    contextBuilder,
  };
}

const PHP_INPUT = {
  projectId: 'project-1',
  projectVersionId: 'version-1',
  retrievalTarget: TARGET,
  framework: 'PHPUNIT' as const,
  language: 'php' as const,
  contextOptions: {},
};

const MONEY_TEST_CHUNK = {
  filePath: 'tests/MoneyTest.php',
  symbolName: 'MoneyTest::testRounding',
  parentSymbolName: 'Tests\\MoneyTest',
  content: 'public function testRounding(): void { $context = new AutoContext(); $m = Money::of(1, $c); }',
  importsUsed: [AUTO_CONTEXT, MONEY],
};

describe('acquireGenerationContext: glosario de FQCN (WI-CORE-104, R2b)', () => {
  it('escenario money-c3: el import del extracto de prueba llega al texto que ve el prompt', async () => {
    const sources = makeSources({ candidates: [candidate('money-test', MONEY_TEST_CHUNK)] });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const prompt = new PromptBuilder().build(generationContext);

    expect(generationContext.relatedChunks.map((related) => related.filePath)).toEqual(['tests/MoneyTest.php']);
    expect(generationContext.dependencyContext?.text).toContain(
      'Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:\n- Gateway → App\\Billing\\Gateway\n- AutoContext → Brick\\Money\\Context\\AutoContext',
    );
    expect(prompt).toContain(`- AutoContext → ${AUTO_CONTEXT}`);
    // El glosario va después de las dependencias, dentro de la misma sección del prompt.
    expect(prompt.indexOf('Dependencias del código objetivo')).toBeLessThan(prompt.indexOf('Nombres completos (FQCN)'));
    expect(prompt.indexOf('Nombres completos (FQCN)')).toBeLessThan(prompt.indexOf('Contexto relacionado del mismo proyecto'));
  });

  it('escenario money-c2: dependencia Money final con constructor privado y fábricas, sin «con new»', async () => {
    const sources = makeSources({ candidates: [candidate('money-test', MONEY_TEST_CHUNK)] });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const prompt = new PromptBuilder().build(generationContext);

    const moneyLine = prompt.split('\n').find((line) => line.startsWith('- Money → '));
    expect(moneyLine).toBe(
      `- Money → ${MONEY} (constructor) — final: no se puede mockear — constructor privado: no uses new; fábricas públicas: of(int $a, Currency $c): static, zero(Currency $c): static`,
    );
    expect(moneyLine).not.toContain('con new');
  });

  it('excluye de las líneas del glosario las dependencias ya listadas y la clase declarante', async () => {
    const sources = makeSources({
      candidates: [candidate('money-test', { ...MONEY_TEST_CHUNK, importsUsed: [AUTO_CONTEXT, MONEY, DECLARING] })],
    });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);

    const glossaryLines = (generationContext.dependencyContext?.text ?? '')
      .split('\n')
      .slice((generationContext.dependencyContext?.text ?? '').split('\n').indexOf('Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:') + 1);
    expect(glossaryLines).toEqual(['- Gateway → App\\Billing\\Gateway', `- AutoContext → ${AUTO_CONTEXT}`]);
  });

  it('orden target → chunks seleccionados y sin duplicados por FQCN', async () => {
    const sources = makeSources({
      candidates: [
        candidate('first', { filePath: 'tests/A.php', importsUsed: ['Z\\Late', AUTO_CONTEXT] }, 0.99),
        candidate('second', { filePath: 'tests/B.php', importsUsed: [AUTO_CONTEXT, 'Y\\Later'] }, 0.9),
      ],
    });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);

    const text = generationContext.dependencyContext?.text ?? '';
    const names = text.split('\n').filter((line) => line.startsWith('- ') && line.includes('→')).map((line) => line.split(' → ')[1]);
    expect(names.indexOf('App\\Billing\\Gateway')).toBeLessThan(names.indexOf('Z\\Late'));
    expect(names.indexOf('Z\\Late')).toBeLessThan(names.indexOf(AUTO_CONTEXT));
    expect(names.indexOf(AUTO_CONTEXT)).toBeLessThan(names.indexOf('Y\\Later'));
    expect(names.filter((name) => name === AUTO_CONTEXT)).toHaveLength(1);
  });

  it('sin dependencias (resolve → null) crea la sección con entries vacío', async () => {
    const sources = makeSources({ candidates: [candidate('money-test', MONEY_TEST_CHUNK)], realDependencies: false });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);

    expect(generationContext.dependencyContext).toMatchObject({ entries: [], transitiveEntries: [], unresolvedCount: 0 });
    expect(generationContext.dependencyContext?.tokenCount).toBeGreaterThan(0);
    expect(generationContext.dependencyContext?.text.startsWith('Nombres completos (FQCN)')).toBe(true);
    // La traza solo expone entries/unresolvedCount/tokenCount/truncated, sin texto ni glosario.
    const detail = makeRagDetail(generationContext) as unknown as { dependencyContext: Record<string, unknown> };
    expect(detail.dependencyContext).toEqual({
      entries: [],
      unresolvedCount: 0,
      tokenCount: generationContext.dependencyContext?.tokenCount,
      truncated: false,
    });
  });

  it('con TypeScript devuelve exactamente el contexto del builder, aunque los chunks traigan imports', async () => {
    const sources = makeSources({ candidates: [candidate('money-test', MONEY_TEST_CHUNK)], realDependencies: false });
    const built = sources.contextBuilder.build(
      await sources.retrievalService.retrieve(),
      TARGET,
      { framework: 'JEST', language: 'typescript' },
      {},
      [],
      null,
    );
    const spy = vi.spyOn(sources.contextBuilder, 'build').mockReturnValue(built);

    const { generationContext } = await acquireGenerationContext(sources as never, { ...PHP_INPUT, language: 'typescript', framework: 'JEST' });

    expect(generationContext).toBe(built);
    expect(generationContext.dependencyContext).toBeUndefined();
    spy.mockRestore();
  });

  it('sin imports nuevos (nada que añadir) devuelve exactamente el mismo contexto de antes', async () => {
    const sources = makeSources({
      candidates: [candidate('money-test', { ...MONEY_TEST_CHUNK, importsUsed: [MONEY] })],
      targetChunks: [{ ...targetChunk, importsUsed: [MONEY] } as CodeChunk],
    });
    const built = sources.contextBuilder.build(
      await sources.retrievalService.retrieve(),
      TARGET,
      { framework: 'PHPUNIT', language: 'php' },
      {},
      [],
      await sources.phpDependencyContextService.resolve('version-1', [targetChunk], 'php'),
    );
    const spy = vi.spyOn(sources.contextBuilder, 'build').mockReturnValue(built);

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);

    expect(generationContext).toBe(built);
    expect(generationContext.dependencyContext?.text).not.toContain('Nombres completos');
    spy.mockRestore();
  });

  it('si el filtro de clases globales deja el glosario vacío devuelve el mismo contexto (igualdad de referencia)', async () => {
    const sources = makeSources({
      candidates: [candidate('money-test', { ...MONEY_TEST_CHUNK, importsUsed: ['DateTimeImmutable', 'Exception', MONEY] })],
      targetChunks: [{ ...targetChunk, importsUsed: [MONEY, 'DateTimeImmutable'] } as CodeChunk],
    });
    const built = sources.contextBuilder.build(
      await sources.retrievalService.retrieve(),
      TARGET,
      { framework: 'PHPUNIT', language: 'php' },
      {},
      [],
      await sources.phpDependencyContextService.resolve('version-1', [targetChunk], 'php'),
    );
    const spy = vi.spyOn(sources.contextBuilder, 'build').mockReturnValue(built);

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);

    expect(generationContext).toBe(built);
    expect(generationContext.dependencyContext?.text).not.toContain('Nombres completos');
    spy.mockRestore();
  });

  it('no cambia selección, contadores ni auditoría respecto de la construcción sin glosario', async () => {
    const sources = makeSources({ candidates: [candidate('money-test', MONEY_TEST_CHUNK)] });
    const resolve = vi.spyOn(sources.phpDependencyContextService, 'resolve');

    const { generationContext, retrieval } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const dependencies = await resolve.mock.results[0].value;
    const plain = sources.contextBuilder.build(retrieval, TARGET, { framework: 'PHPUNIT', language: 'php' }, {}, [], dependencies);

    expect(generationContext.contextTokens).toBe(plain.contextTokens);
    expect(generationContext.selectedChunks).toBe(plain.selectedChunks);
    expect(generationContext.audit).toEqual(plain.audit);
    expect(generationContext.relatedChunks).toEqual(plain.relatedChunks);
    expect(generationContext.dependencyContext?.entries).toEqual(plain.dependencyContext?.entries);
  });

  it('la compuerta de suficiencia sigue igual con el glosario añadido', async () => {
    const withCode = makeSources({ candidates: [candidate('money-test', MONEY_TEST_CHUNK)] });
    await expect(
      acquireGenerationContext(withCode as never, { ...PHP_INPUT, sufficiency: { requiredScenarioKeys: [] } }),
    ).resolves.toBeDefined();

    const withoutCode = makeSources({
      candidates: [candidate('money-test', MONEY_TEST_CHUNK)],
      targetChunks: [{ ...targetChunk, content: '' } as CodeChunk],
    });
    await expect(
      acquireGenerationContext(withoutCode as never, { ...PHP_INPUT, sufficiency: { requiredScenarioKeys: [] } }),
    ).rejects.toBeInstanceOf(InsufficientGenerationContextError);
  });
});
