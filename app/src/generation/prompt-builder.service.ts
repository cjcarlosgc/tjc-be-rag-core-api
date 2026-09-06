import { Injectable } from '@nestjs/common';
import type { GenerationContext } from '../retrieval/generation-context.js';
import type { RepairContext } from './repair/repair-context.js';

@Injectable()
export class PromptBuilder {
  build(context: GenerationContext): string {
    const targetLabel = context.target.methodName
      ? `${context.target.symbolName}.${context.target.methodName}`
      : context.target.symbolName;
    const targetKind = context.target.targetType === 'METHOD' ? 'el método' : 'la función';

    const relatedSections = context.relatedChunks
      .map((chunk) => {
        const label = chunk.parentSymbolName
          ? `${chunk.parentSymbolName}.${chunk.symbolName}`
          : (chunk.symbolName ?? '(archivo completo)');

        return `--- ${chunk.filePath} (${chunk.symbolKind} ${label}) ---\n${chunk.content}`;
      })
      .join('\n\n');

    const frameworkLine = context.metadata.framework
      ? `Usa el framework de pruebas ${context.metadata.framework}.`
      : 'Usa Jest o Vitest, el que ya use el proyecto (sintaxis compatible con ambos si no puedes determinarlo).';

    const sections = [
      'Eres un ingeniero de software senior escribiendo pruebas unitarias en TypeScript.',
      `Objetivo: escribir una prueba unitaria para ${targetKind} "${targetLabel}" en ${context.target.filePath}.`,
      frameworkLine,
      'Código objetivo:',
      '```ts',
      context.target.content,
      '```',
      relatedSections.length > 0 ? `Contexto relacionado del mismo proyecto:\n${relatedSections}` : null,
      'Responde ÚNICAMENTE con código TypeScript válido (imports + bloques de prueba). No incluyas explicaciones ni comentarios de proceso. No envuelvas la respuesta en fences de markdown.',
    ];

    return sections.filter((section): section is string => section !== null).join('\n\n');
  }

  buildRepair(context: RepairContext): string {
    const { generationContext, failedTestContent, failureType, errorSummary, runnerFacts } = context;
    const targetLabel = generationContext.target.methodName
      ? `${generationContext.target.symbolName}.${generationContext.target.methodName}`
      : generationContext.target.symbolName;

    const failedCasesSummary = runnerFacts
      ? runnerFacts.testCases
          .filter((testCase) => testCase.status === 'FAILED')
          .map((testCase) => `- ${testCase.name}: ${testCase.errorMessage ?? '(sin mensaje)'}`)
          .join('\n')
      : '';

    const sections = [
      'Eres un ingeniero de software senior corrigiendo una prueba unitaria en TypeScript que falló al validarse en el Sandbox.',
      `Objetivo: corregir la prueba unitaria para "${targetLabel}" en ${generationContext.target.filePath}.`,
      'Código objetivo:',
      '```ts',
      generationContext.target.content,
      '```',
      'Prueba generada previamente (falló la validación):',
      '```ts',
      failedTestContent,
      '```',
      `Tipo de fallo: ${failureType}.`,
      errorSummary ? `Resumen del error: ${errorSummary}` : null,
      failedCasesSummary.length > 0 ? `Casos fallidos:\n${failedCasesSummary}` : null,
      'Corrige la prueba para que compile y pase, conservando su intención original y el framework de pruebas ya usado. Responde ÚNICAMENTE con el código TypeScript completo y corregido (imports + bloques de prueba). No incluyas explicaciones ni envuelvas la respuesta en fences de markdown.',
    ];

    return sections.filter((section): section is string => section !== null).join('\n\n');
  }
}
