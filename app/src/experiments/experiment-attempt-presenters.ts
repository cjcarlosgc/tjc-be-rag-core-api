/**
 * Funciones puras de presentación del intento de un experimento (instrucciones del agente, detalle de la traza RAG,
 * extractos de fuente y pasos de trayectoria saneados). Extraídas de `ExperimentJobHandler` sin cambios de lógica
 * (refactor SDD 3.1): no usan estado de instancia.
 */
import { createHash } from 'node:crypto';
import type { PhpTestLocation } from '../generation/php-test-path.js';
import { PHP_PHPUNIT_CONVENTION_LINES } from '../generation/php-phpunit-conventions.js';
import type { AgentTrajectoryStep } from '../generation/agent/generalist-agent.service.js';
import type { Prisma, TestTarget } from '../generated/prisma/client.js';
import type { GenerationContext } from '../retrieval/generation-context.js';
import { toFunctionalRuleEvidence } from '../retrieval/functional-rule-evidence.js';

export function buildAgentInstructions(
  target: TestTarget,
  framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null,
  placement: PhpTestLocation | null,
  maxContextTokens: number,
  maxToolCalls: number,
): string {
  if (placement) {
    return buildPhpAgentInstructions(
      target,
      placement,
      maxContextTokens,
      maxToolCalls,
    );
  }

  const label = target.methodName
    ? `${target.symbolName}.${target.methodName}`
    : target.symbolName;
  const kind = target.targetType === 'METHOD' ? 'el método' : 'la función';
  const frameworkLine = framework
    ? `Usa el framework de pruebas ${framework}.`
    : 'Usa Jest o Vitest, el que ya use el proyecto (sintaxis compatible con ambos si no puedes determinarlo).';

  return [
    'Eres un ingeniero de software senior escribiendo pruebas unitarias en TypeScript.',
    `Objetivo: escribir una prueba unitaria para ${kind} "${label}", declarada en el archivo "${target.filePath}".`,
    'No se te entrega el código del objetivo directamente: debes explorarlo tú mismo usando las herramientas disponibles (list_files, read_file, search_text, inspect_symbol) antes de generar la prueba.',
    frameworkLine,
    `Tienes como máximo ${maxToolCalls} llamadas a herramientas; al alcanzar ese límite deberás responder sin más herramientas.`,
    `Presupuesto de contexto: los resultados de las herramientas suman como máximo ${maxContextTokens} tokens en total; lo que exceda se trunca y queda marcado como truncado.`,
    'Cuando tengas suficiente información, responde ÚNICAMENTE con código TypeScript válido (imports + bloques de prueba). No incluyas explicaciones ni envuelvas la respuesta en fences de markdown.',
  ].join('\n\n');
}

/** Instrucciones del agente para PHP (WI-CORE-029): mismas semánticas que TypeScript, PHPUnit 11. */
export function buildPhpAgentInstructions(
  target: TestTarget,
  placement: PhpTestLocation,
  maxContextTokens: number,
  maxToolCalls: number,
): string {
  const label = target.methodName
    ? `${target.symbolName}.${target.methodName}`
    : target.symbolName;
  const kind = target.targetType === 'METHOD' ? 'el método' : 'la función';

  return [
    'Eres un ingeniero de software senior escribiendo pruebas unitarias en PHP.',
    `Objetivo: escribir una prueba unitaria para ${kind} "${label}", declarada en el archivo "${target.filePath}".`,
    'No se te entrega el código del objetivo directamente: debes explorarlo tú mismo usando las herramientas disponibles (list_files, read_file, search_text, inspect_symbol) antes de generar la prueba.',
    'Usa el framework de pruebas PHPUnit 11.',
    `El archivo de prueba es "${placement.relativePath}" y debe declarar el namespace "${placement.namespace}".`,
    'Usa declaraciones use con nombres de clase completos (namespace completo). Extiende Tests\\TestCase solo si el código usa el contenedor de Laravel; en otro caso extiende PHPUnit\\Framework\\TestCase.',
    ...PHP_PHPUNIT_CONVENTION_LINES,
    `Tienes como máximo ${maxToolCalls} llamadas a herramientas; al alcanzar ese límite deberás responder sin más herramientas.`,
    `Presupuesto de contexto: los resultados de las herramientas suman como máximo ${maxContextTokens} tokens en total; lo que exceda se trunca y queda marcado como truncado.`,
    'Cuando tengas suficiente información, responde ÚNICAMENTE con el archivo PHP completo: empieza con <?php, declara el namespace y los use, y contiene la clase de prueba. No incluyas explicaciones ni envuelvas la respuesta en fences de markdown.',
  ].join('\n\n');
}

export function makeRagDetail(
  generationContext: GenerationContext,
): Prisma.InputJsonValue {
  const audit = generationContext.audit;
  if (!audit) {
    throw new Error('ContextBuilder no produjo evidencia para la traza RAG.');
  }

  const targetChunks = audit.target.chunks;
  const firstTargetChunk = targetChunks[0];
  const combinedTargetContent = targetChunks
    .map((chunk) => chunk.content)
    .join('\n\n');
  const targetExcerpt = makeSourceExcerpt(
    combinedTargetContent,
    firstTargetChunk
      ? {
          filePath: firstTargetChunk.filePath,
          symbolName: firstTargetChunk.symbolName,
          parentSymbolName: firstTargetChunk.parentSymbolName,
          startLine: Math.min(
            ...targetChunks.map((chunk) => chunk.startLine),
          ),
          endLine: Math.max(...targetChunks.map((chunk) => chunk.endLine)),
        }
      : {
          filePath: generationContext.target.filePath,
          symbolName: generationContext.target.symbolName,
          parentSymbolName: null,
          startLine: null,
          endLine: null,
        },
  );

  const dependency = generationContext.dependencyContext;
  const dependencyEvidence =
    // WI-CORE-104: con solo glosario de FQCN no hay entradas, pero la sección existe (`tokenCount > 0`).
    dependency &&
    (dependency.entries.length > 0 || dependency.unresolvedCount > 0 || dependency.tokenCount > 0)
      ? {
          // WI-CORE-057 (INTEROP-2.14): sin `text`; el texto solo viaja al prompt.
          dependencyContext: {
            entries: dependency.entries.map((entry) => ({
              typeName: entry.typeName,
              fqcn: entry.fqcn,
              origin: entry.origin,
              resolvedBy: entry.resolvedBy,
              // WI-CORE-058 (INTEROP-2.15): solo se persiste `true`; nunca `final: false`.
              ...(entry.final === true ? { final: true as const } : {}),
            })),
            unresolvedCount: dependency.unresolvedCount,
            tokenCount: dependency.tokenCount,
            truncated: dependency.truncated,
          },
        }
      : {};

  return {
    target: {
      chunkIds: audit.target.chunkIds,
      excerpt: targetExcerpt,
      tokenCount: audit.target.tokenCount,
    },
    ...dependencyEvidence,
    candidates: audit.candidates.map((candidate) => ({
      chunkId: candidate.chunkId,
      rank: candidate.rank,
      excerpt: makeSourceExcerpt(candidate.content, candidate),
      tokenCount: candidate.tokenCount,
      semanticScore: candidate.semanticScore,
      structuralMatch: candidate.structuralMatch,
      combinedScore: candidate.combinedScore,
      matchedVia: candidate.matchedVia,
      decision: candidate.decision,
      discardReason: candidate.discardReason,
      layer: candidate.layer,
    })),
    retrievedChunks: generationContext.retrievedChunks,
    selectedChunks: generationContext.selectedChunks,
    contextTokens: generationContext.contextTokens,
    configuration: audit.configuration,
    // WI-CORE-026 (obligación de WI-CORE-021): ids, conteos y omitidas; sin procedencia ni texto de regla.
    functionalRules: toFunctionalRuleEvidence(generationContext),
  } as Prisma.InputJsonValue;
}

export function makeSourceExcerpt(
  content: string,
  location: {
    filePath: string;
    symbolName: string | null;
    parentSymbolName: string | null;
    startLine: number | null;
    endLine: number | null;
  },
): {
  filePath: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  snippet: string;
  contentSha256: string;
  truncated: boolean;
} {
  const maxSnippetChars = 2000;
  if (!isSafeRelativePath(location.filePath)) {
    throw new Error('ContextTrace requiere una ruta relativa segura.');
  }
  return {
    filePath: location.filePath,
    symbolName: location.symbolName,
    parentSymbolName: location.parentSymbolName,
    startLine: location.startLine,
    endLine: location.endLine,
    snippet: content.slice(0, maxSnippetChars),
    contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    truncated: content.length > maxSnippetChars,
  };
}

export function safeAgentStep(step: AgentTrajectoryStep): Prisma.InputJsonObject {
  const args = { ...step.arguments };
  if (
    typeof args.relativePath === 'string' &&
    !isSafeRelativePath(args.relativePath)
  ) {
    args.relativePath = '[ruta rechazada]';
  }
  const observations = step.observations.map((observation) => {
    const excerpt =
      observation.excerpt &&
      isSafeRelativePath(observation.excerpt.filePath)
        ? {
            filePath: observation.excerpt.filePath,
            symbolName: observation.excerpt.symbolName,
            parentSymbolName: observation.excerpt.parentSymbolName,
            startLine: observation.excerpt.startLine,
            endLine: observation.excerpt.endLine,
            snippet: observation.excerpt.snippet.slice(0, 2000),
            contentSha256: observation.excerpt.contentSha256,
            truncated: observation.excerpt.truncated,
          }
        : null;

    return {
      kind: observation.kind,
      filePath:
        observation.filePath && isSafeRelativePath(observation.filePath)
          ? observation.filePath
          : null,
      symbolName: observation.symbolName,
      excerpt,
      discoveredFilesCount: observation.discoveredFilesCount,
    };
  });

  return {
    step: step.step,
    toolName: step.toolName,
    arguments: args,
    status: step.status,
    resultSummary: describeAgentResult(step, args),
    resultSha256: step.resultSha256,
    truncated: step.truncated,
    contextTokens: step.contextTokens,
    truncationReason: step.truncationReason,
    observations,
  } as Prisma.InputJsonObject;
}

export function describeAgentResult(
  step: AgentTrajectoryStep,
  args: Record<string, unknown>,
): string {
  if (step.status === 'FAILED') return 'No se pudo completar la herramienta.';
  if (step.toolName === 'list_files') {
    const count =
      step.observations.find((item) => item.kind === 'FILE_LIST_SUMMARY')
        ?.discoveredFilesCount ?? 0;
    return `Listado disponible: ${count} archivos.`;
  }
  if (step.toolName === 'search_text') {
    const matches = step.observations.filter(
      (item) => item.kind === 'TEXT_MATCH',
    );
    const files = new Set(
      matches.map((item) => item.filePath).filter(Boolean),
    );
    return matches.length === 0
      ? 'No se encontraron coincidencias.'
      : `Se observaron ${matches.length} coincidencias en ${files.size} archivos.`;
  }
  if (step.toolName === 'inspect_symbol') {
    const found = step.observations.find((item) => item.kind === 'SYMBOL');
    if (!found) return 'No se encontró el símbolo solicitado.';
    const symbol = found.symbolName ?? 'Símbolo';
    const location = found.filePath ? ` en ${found.filePath}` : '';
    return `${symbol} inspeccionado${location}.`;
  }
  const filePath =
    (typeof args.relativePath === 'string' &&
    isSafeRelativePath(args.relativePath)
      ? args.relativePath
      : null) ??
    step.observations.find((item) => item.kind === 'FILE_CONTENT')
      ?.filePath ??
    'archivo';
  const excerpt = step.observations.find(
    (item) => item.kind === 'FILE_CONTENT',
  )?.excerpt;
  const lines =
    excerpt?.startLine !== null && excerpt?.startLine !== undefined
      ? ` (líneas ${excerpt.startLine}-${excerpt.endLine ?? excerpt.startLine})`
      : '';
  return step.status === 'EMPTY'
    ? `No se observó contenido en ${filePath}.`
    : `Contenido observado en ${filePath}${lines}.`;
}

export function isSafeRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith('/') &&
    !filePath.includes('\\') &&
    !filePath
      .split('/')
      .some(
        (segment) => segment === '.' || segment === '..' || segment === '',
      )
  );
}
