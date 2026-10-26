import { describe, expect, it, vi } from 'vitest';
import { acquireGenerationContext } from './test-generation-pipeline.js';
import { PromptBuilder } from './prompt-builder.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { PhpDependencyContextService } from '../retrieval/php-dependency-context.service.js';
import { makeRagDetail } from '../experiments/experiment-attempt-presenters.js';
import type { CodeChunk } from '../generated/prisma/client.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';
import type { RetrievalCandidate } from '../retrieval/retrieval.service.js';

const NS = 'Acme\\Mapping';
const FILE_DRIVER = `${NS}\\FileDriver`;
const DRIVER = `${NS}\\MappingDriver`;
const LOCATOR = `${NS}\\FileLocator`;
const TARGET = {
  filePath: 'src/Mapping/FileDriver.php',
  symbolName: 'FileDriver::getCachedNames',
  methodName: 'getCachedNames',
  targetType: 'METHOD' as const,
};
const SIGNATURE = 'loadMetadataForClass(string $className, ClassMetadata $metadata): void';

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
  symbolName: TARGET.symbolName,
  parentSymbolName: FILE_DRIVER,
  content: 'public function getCachedNames(): array { return []; }',
});

function candidate(id: string, overrides: Partial<CodeChunk>, semanticScore = 0.95): RetrievalCandidate {
  return { chunk: chunk(id, overrides), semanticScore, structuralMatch: null };
}

function makeRepository(options: { withConstructor?: boolean } = {}) {
  const withConstructor = options.withConstructor ?? true;
  const file = [
    {
      filePath: TARGET.filePath,
      symbolKind: 'CLASS',
      symbolName: FILE_DRIVER,
      parentSymbolName: null,
      importsUsed: [],
      content: 'abstract class FileDriver implements MappingDriver { }',
    },
    ...(withConstructor
      ? [
          {
            filePath: TARGET.filePath,
            symbolKind: 'CONSTRUCTOR',
            symbolName: '__construct',
            parentSymbolName: FILE_DRIVER,
            importsUsed: [],
            content: 'public function __construct(protected FileLocator $locator) {}',
          },
        ]
      : []),
    {
      filePath: TARGET.filePath,
      symbolKind: 'METHOD',
      symbolName: `${FILE_DRIVER}::getAllClassNames`,
      parentSymbolName: FILE_DRIVER,
      importsUsed: [],
      content: 'public function getAllClassNames(): array { return []; }',
    },
    {
      filePath: TARGET.filePath,
      symbolKind: 'METHOD',
      symbolName: `${FILE_DRIVER}::loadMappingFile`,
      parentSymbolName: FILE_DRIVER,
      importsUsed: [],
      content: 'abstract protected function loadMappingFile(string $file): array;',
    },
  ];
  const interfaceContent = `interface MappingDriver
{
    public function ${SIGNATURE};

    public function getAllClassNames(): array;
}`;
  return {
    findByFile: vi.fn().mockResolvedValue(file),
    findPhpTypeSymbolNames: vi.fn().mockResolvedValue([FILE_DRIVER, DRIVER, LOCATOR]),
    findPhpTypeDeclarations: vi.fn().mockResolvedValue([{ symbolName: LOCATOR, symbolKind: 'INTERFACE', content: 'interface FileLocator {}' }]),
    findPhpConstructorDeclarations: vi.fn().mockResolvedValue([]),
    findPhpStaticMethodDeclarations: vi.fn().mockResolvedValue([]),
    findPhpTypeDeclarationParts: vi.fn().mockResolvedValue([
      { symbolName: DRIVER, symbolKind: 'INTERFACE', partIndex: 1, content: interfaceContent, importsUsed: [] },
    ]),
    findPhpMethodDeclarations: vi.fn().mockResolvedValue([]),
  } as unknown as CodeChunksRepository;
}

function makeSources(options: { candidates?: RetrievalCandidate[]; withConstructor?: boolean } = {}) {
  const contextBuilder = new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as never);
  return {
    retrievalService: { retrieve: vi.fn().mockResolvedValue({ targetChunks: [targetChunk], candidates: options.candidates ?? [] }) },
    functionalRulesRetriever: { retrieve: vi.fn().mockResolvedValue([]) },
    phpDependencyContextService: new PhpDependencyContextService(makeRepository({ withConstructor: options.withConstructor })),
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

const OBLIGATIONS_HEADER = 'Métodos abstractos sin implementar de la jerarquía (una subclase concreta debe implementarlos):';
const GLOSSARY_HEADER = 'Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:';

describe('acquireGenerationContext: obligaciones abstractas heredadas (WI-CORE-106)', () => {
  it('el prompt contiene el bloque, y ni la traza ni el JSON persistido exponen las firmas', async () => {
    const sources = makeSources();

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const prompt = new PromptBuilder().build(generationContext);

    expect(generationContext.dependencyContext?.text).toContain(`- MappingDriver::${SIGNATURE}`);
    expect(generationContext.dependencyContext?.text).toContain('- FileDriver::loadMappingFile(string $file): array');
    expect(generationContext.dependencyContext?.text).not.toContain('getAllClassNames');
    expect(prompt).toContain(OBLIGATIONS_HEADER);
    expect(prompt).toContain(`- MappingDriver::${SIGNATURE}`);

    const detail = makeRagDetail(generationContext) as unknown as { dependencyContext: Record<string, unknown> };
    expect(Object.keys(detail.dependencyContext).sort()).toEqual(['entries', 'tokenCount', 'truncated', 'unresolvedCount']);
    expect(detail.dependencyContext).toEqual({
      entries: [{ typeName: 'FileLocator', fqcn: LOCATOR, origin: 'CONSTRUCTOR', resolvedBy: 'SAME_NAMESPACE' }],
      unresolvedCount: 0,
      tokenCount: generationContext.dependencyContext?.tokenCount,
      truncated: false,
    });
    expect(detail.dependencyContext.tokenCount as number).toBeLessThanOrEqual(500);
    const persisted = JSON.stringify(makeRagDetail(generationContext));
    expect(persisted).not.toContain('loadMetadataForClass');
    expect(persisted).not.toContain('loadMappingFile');
    expect(persisted).not.toContain(OBLIGATIONS_HEADER);
    expect(persisted).not.toContain('abstractObligations');
    // Todo está en el índice y no hay traits: sin aviso de jerarquía incompleta.
    expect(prompt).not.toContain('no se conoce por completo');
    expect(persisted).not.toContain('Uncertain');
  });

  it('con jerarquía incompleta el prompt lleva el aviso y la traza sigue sin exponer nada nuevo', async () => {
    const sources = makeSources();
    const repository = (sources.phpDependencyContextService as unknown as { codeChunks: { findByFile: () => Promise<unknown> } }).codeChunks;
    const file = (await repository.findByFile()) as Array<{ symbolKind: string; content: string }>;
    file[0].content = 'abstract class FileDriver implements MappingDriver { use Loggable; }';

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const prompt = new PromptBuilder().build(generationContext);

    expect(prompt).toContain('la jerarquía no se conoce por completo');
    expect(prompt).toContain(`- MappingDriver::${SIGNATURE}`);
    const detail = makeRagDetail(generationContext) as unknown as { dependencyContext: Record<string, unknown> };
    expect(Object.keys(detail.dependencyContext).sort()).toEqual(['entries', 'tokenCount', 'truncated', 'unresolvedCount']);
    expect(JSON.stringify(detail)).not.toContain('no se conoce por completo');
    expect(JSON.stringify(detail)).not.toContain('Uncertain');
  });

  it('con solo el bloque (sin dependencias) la traza trae entries vacío y tokenCount > 0', async () => {
    const sources = makeSources({ withConstructor: false });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);

    expect(generationContext.dependencyContext?.entries).toEqual([]);
    expect(generationContext.dependencyContext?.text.startsWith(OBLIGATIONS_HEADER)).toBe(true);
    const detail = makeRagDetail(generationContext) as unknown as { dependencyContext: Record<string, unknown> };
    expect(detail.dependencyContext).toEqual({
      entries: [],
      unresolvedCount: 0,
      tokenCount: generationContext.dependencyContext?.tokenCount,
      truncated: false,
    });
    expect(detail.dependencyContext.tokenCount as number).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toContain('loadMetadataForClass');
  });

  it('con glosario y obligaciones se componen ambos, en el orden dependencias, obligaciones y glosario', async () => {
    const sources = makeSources({
      candidates: [candidate('related', { filePath: 'tests/RelatedTest.php', importsUsed: ['Acme\\Support\\Clock', 'Acme\\Support\\Formatter'] })],
    });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const text = generationContext.dependencyContext?.text ?? '';
    const prompt = new PromptBuilder().build(generationContext);

    expect(text).toContain(OBLIGATIONS_HEADER);
    expect(text).toContain(GLOSSARY_HEADER);
    expect(text).toContain('- Clock → Acme\\Support\\Clock');
    expect(text.indexOf('Dependencias del código objetivo')).toBeLessThan(text.indexOf(OBLIGATIONS_HEADER));
    expect(text.indexOf(OBLIGATIONS_HEADER)).toBeLessThan(text.indexOf(GLOSSARY_HEADER));
    expect(prompt.indexOf(OBLIGATIONS_HEADER)).toBeLessThan(prompt.indexOf(GLOSSARY_HEADER));
    expect(generationContext.dependencyContext?.tokenCount).toBeLessThanOrEqual(500);
    expect(generationContext.dependencyContext?.entries.map((entry) => entry.fqcn)).toEqual([LOCATOR]);

    // El JSON de la traza sigue sin firmas ni glosario.
    const persisted = JSON.stringify(makeRagDetail(generationContext));
    expect(persisted).not.toContain('loadMetadataForClass');
    expect(persisted).not.toContain('Acme\\\\Support\\\\Clock');
  });

  it('un glosario grande se recorta antes que las obligaciones dentro del tope de 500 tokens', async () => {
    const imports = Array.from({ length: 30 }, (_, index) => `Acme\\Wide\\Namespace\\Section${index}\\VeryLongTypeName${index}`);
    const sources = makeSources({ candidates: [candidate('related', { filePath: 'tests/RelatedTest.php', importsUsed: imports })] });

    const { generationContext } = await acquireGenerationContext(sources as never, PHP_INPUT);
    const text = generationContext.dependencyContext?.text ?? '';

    expect(generationContext.dependencyContext?.tokenCount).toBeLessThanOrEqual(500);
    expect(generationContext.dependencyContext?.truncated).toBe(true);
    expect(text).toContain(`- MappingDriver::${SIGNATURE}`);
    expect(text.split('\n').filter((line) => line.includes('VeryLongTypeName')).length).toBeLessThan(30);
  });

  it('TypeScript queda intacto: sin sección ni bloque en el prompt', async () => {
    const sources = makeSources();
    const resolve = vi.spyOn(sources.phpDependencyContextService, 'resolve');

    const { generationContext } = await acquireGenerationContext(sources as never, {
      ...PHP_INPUT,
      language: 'typescript',
      framework: 'JEST',
    });
    const prompt = new PromptBuilder().build(generationContext);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(generationContext.dependencyContext).toBeUndefined();
    expect(prompt).not.toContain(OBLIGATIONS_HEADER);
  });
});
