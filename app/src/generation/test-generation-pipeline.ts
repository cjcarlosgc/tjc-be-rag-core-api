import { randomUUID } from 'node:crypto';
import type {
  ContextBuilder,
  ContextBuilderOptions,
} from '../retrieval/context-builder.service.js';
import type { FunctionalRulesRetriever } from '../retrieval/functional-rules.retriever.js';
import type { PhpDependencyContextService } from '../retrieval/php-dependency-context.service.js';
import type {
  GenerationContext,
  RetrievalTarget,
} from '../retrieval/generation-context.js';
import type { RetrievalService } from '../retrieval/retrieval.service.js';
import type {
  ExecutionProfile,
  SandboxExecutionRequest,
} from '../sandbox/sandbox.types.js';
import {
  sanitizeGeneratedPhp,
  type PromptBuilder,
} from './prompt-builder.service.js';
import type { TestFileMergeService } from './test-file-merge.service.js';
import { assessContextSufficiency } from './context-sufficiency.js';

/**
 * Pasos comunes del pipeline de generación (WI-CORE-070, corte B) que usan `ExperimentJobHandler`
 * y `AnalysisRunValidationJobHandler`: contexto, prompt, fusión y solicitud al Sandbox.
 *
 * Son funciones puras o inyectadas, sin estado. NO incluyen, a propósito, lo que los handlers
 * conservan propio: la llamada al LLM (configuración y timeout), el manejo de errores, las
 * escrituras de traza y de persistencia, `existingContent`/ruta (el orden de lectura es distinto
 * en cada handler), el presupuesto de contexto, el hash del artefacto y la clasificación.
 */

/** Dependencias de lectura del contexto; las inyecta cada handler con sus propios servicios. */
export interface GenerationContextSources {
  retrievalService: Pick<RetrievalService, 'retrieve'>;
  functionalRulesRetriever: Pick<FunctionalRulesRetriever, 'retrieve'>;
  phpDependencyContextService: Pick<PhpDependencyContextService, 'resolve'>;
  contextBuilder: Pick<ContextBuilder, 'build'>;
}

export interface AcquireGenerationContextInput {
  projectId: string;
  projectVersionId: string;
  retrievalTarget: RetrievalTarget;
  framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null;
  language: 'php' | 'typescript';
  /**
   * Opciones del ContextBuilder. Experimentos pasa el presupuesto (`maxContextTokens`) y validación
   * pasa `{}`: la diferencia se conserva en el caller.
   */
  contextOptions: ContextBuilderOptions;
  /**
   * WI-CORE-098 (D-5): si se pasa, se aplica la compuerta de contexto suficiente tras construir el contexto
   * y se lanza `InsufficientGenerationContextError` sin devolver `GenerationContext`. Sin este parámetro el
   * comportamiento es el de siempre. Solo lo usan validación y el pre-chequeo de experimentos.
   */
  sufficiency?: { requiredScenarioKeys: readonly string[] };
}

/**
 * Recuperación, reglas funcionales, dependencias PHP y construcción del contexto, en ese orden.
 * El caller persiste su traza después (updateDetail en experimentos, persistTraceEvidence en validación).
 */
export async function acquireGenerationContext(
  sources: GenerationContextSources,
  input: AcquireGenerationContextInput,
): Promise<{
  retrieval: Awaited<ReturnType<RetrievalService['retrieve']>>;
  generationContext: GenerationContext;
}> {
  const retrieval = await sources.retrievalService.retrieve(
    input.projectVersionId,
    input.retrievalTarget,
  );
  const functionalRules = await sources.functionalRulesRetriever.retrieve(
    input.projectId,
    input.retrievalTarget,
  );
  // WI-CORE-057: dependencias FQCN del target PHP; null fuera de PHP o sin entradas.
  const dependencyContext = await sources.phpDependencyContextService.resolve(
    input.projectVersionId,
    retrieval.targetChunks,
    input.language,
  );
  const generationContext = sources.contextBuilder.build(
    retrieval,
    input.retrievalTarget,
    { framework: input.framework, language: input.language },
    input.contextOptions,
    functionalRules,
    dependencyContext,
  );
  if (input.sufficiency) {
    const insufficiency = assessContextSufficiency({
      generationContext,
      retrievedRuleScenarioKeys: functionalRules.map((rule) => rule.scenarioKey),
      requiredScenarioKeys: input.sufficiency.requiredScenarioKeys,
    });
    if (insufficiency) {
      throw insufficiency;
    }
  }
  return { retrieval, generationContext };
}

/** Ubicación PHP ya normalizada por el caller (`testNamespace` puede ser undefined, no null). */
export interface TestPromptPlacement {
  testNamespace: string | undefined;
  testPath: string;
}

/** Prompt del test: con ubicación PHP si `placement` no es null; sin opciones en otro caso. */
export function buildTestPrompt(
  promptBuilder: Pick<PromptBuilder, 'build'>,
  context: GenerationContext,
  placement: TestPromptPlacement | null,
): string {
  return placement
    ? promptBuilder.build(context, {
        testNamespace: placement.testNamespace,
        testPath: placement.testPath,
      })
    : promptBuilder.build(context);
}

export interface MergedGeneratedTest {
  /** Contenido exacto que se envía al Sandbox y del que se calcula el hash del artefacto. */
  content: string;
  artifactType: 'CREATED' | 'MODIFIED';
}

export type GeneratedTestMerge =
  | ({ kind: 'MERGED' } & MergedGeneratedTest)
  | { kind: 'INVALID_PHP' };

export interface GeneratedTestMergeInput {
  language: 'php' | 'typescript';
  generatedContent: string;
  /**
   * Contenido previo del test co-ubicado (TypeScript). PHP no lo usa: siempre es un archivo nuevo
   * (DEC-PHP-GEN-001). `null` significa que no existe.
   */
  existingContent: string | null;
}

/**
 * Contenido final del test. PHP: sanea la respuesta y añade un salto de línea, o `INVALID_PHP` si no
 * empieza con `<?php`. TypeScript: crea el archivo o fusiona con el existente.
 */
export function mergeGeneratedTest(
  merge: Pick<TestFileMergeService, 'applyCreate' | 'applyMerge'>,
  input: GeneratedTestMergeInput,
): GeneratedTestMerge {
  if (input.language === 'php') {
    const phpContent = sanitizeGeneratedPhp(input.generatedContent);
    if (phpContent === null) {
      return { kind: 'INVALID_PHP' };
    }
    return { kind: 'MERGED', content: `${phpContent}\n`, artifactType: 'CREATED' };
  }
  if (input.existingContent === null) {
    return {
      kind: 'MERGED',
      content: merge.applyCreate(input.generatedContent),
      artifactType: 'CREATED',
    };
  }
  return {
    kind: 'MERGED',
    content: merge.applyMerge(input.existingContent, input.generatedContent),
    artifactType: 'MODIFIED',
  };
}

export interface SandboxExecuteRequestInput {
  requestId: string;
  testRunId: string;
  projectVersionId: string;
  snapshotKey: string;
  snapshotBuffer: Buffer;
  relativePath: string;
  artifactType: 'CREATED' | 'MODIFIED';
  mergedContent: string;
  targetId: string;
  runnerHint: 'JEST' | 'VITEST' | 'PHPUNIT';
  language: 'php' | 'typescript';
  projectRoot: string;
  /**
   * Solo se incluye la clave `executionProfile` si el caller la pasa (aunque valga undefined).
   * Experimentos la envía; validación no la envía nunca.
   */
  executionProfile?: ExecutionProfile | undefined;
}

/**
 * Solicitud del Sandbox para un único artefacto con alcance TARGET. `projectRoot` solo va en PHP.
 * El orden de las claves es el mismo que tenía cada handler antes de compartir esta función.
 */
export function buildSandboxExecuteRequest(
  input: SandboxExecuteRequestInput,
): SandboxExecutionRequest {
  return {
    requestId: input.requestId,
    testRunId: input.testRunId,
    projectVersionId: input.projectVersionId,
    snapshotKey: input.snapshotKey,
    snapshotBuffer: input.snapshotBuffer,
    artifacts: [
      {
        artifactId: randomUUID(),
        relativePath: input.relativePath,
        artifactType: input.artifactType,
        content: Buffer.from(input.mergedContent, 'utf8'),
      },
    ],
    scope: 'TARGET',
    targetIds: [input.targetId],
    runnerHint: input.runnerHint,
    ...('executionProfile' in input
      ? { executionProfile: input.executionProfile }
      : {}),
    ...(input.language === 'php' ? { projectRoot: input.projectRoot } : {}),
  };
}
