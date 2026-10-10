import { Injectable } from '@nestjs/common';
import type { GenerationContext } from '../retrieval/generation-context.js';
import { renderFunctionalRule } from '../retrieval/functional-rule-format.js';

/** Datos de ubicación del test PHP, presentes solo para `language: 'php'`. */
export interface PromptBuildOptions {
  testNamespace?: string;
  testPath?: string;
}

const PHP_FENCE_PATTERN = /^```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/;

/**
 * Retira fences de markdown de una respuesta de generación PHP y recorta espacios.
 * Devuelve null si el resultado no empieza con `<?php` (fallo técnico de generación).
 */
export function sanitizeGeneratedPhp(content: string): string | null {
  const trimmed = content.trim();
  const fenced = PHP_FENCE_PATTERN.exec(trimmed);
  const body = (fenced ? fenced[1] : trimmed).trim();

  return body.startsWith('<?php') ? body : null;
}

@Injectable()
export class PromptBuilder {
  build(context: GenerationContext, options: PromptBuildOptions = {}): string {
    if (context.metadata.language === 'php') {
      return this.buildPhp(context, options);
    }

    const targetLabel = context.target.methodName
      ? `${context.target.symbolName}.${context.target.methodName}`
      : context.target.symbolName;
    const targetKind = context.target.targetType === 'METHOD' ? 'el método' : 'la función';

    const relatedSections = this.renderRelatedSections(context);
    const functionalRulesSection = this.renderFunctionalRulesSection(context);

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
      functionalRulesSection,
      relatedSections.length > 0 ? `Contexto relacionado del mismo proyecto:\n${relatedSections}` : null,
      'Responde ÚNICAMENTE con código TypeScript válido (imports + bloques de prueba). No incluyas explicaciones ni comentarios de proceso. No envuelvas la respuesta en fences de markdown.',
    ];

    return sections.filter((section): section is string => section !== null).join('\n\n');
  }

  private buildPhp(context: GenerationContext, options: PromptBuildOptions): string {
    const targetLabel = context.target.methodName
      ? `${context.target.symbolName}.${context.target.methodName}`
      : context.target.symbolName;
    const targetKind = context.target.targetType === 'METHOD' ? 'el método' : 'la función';

    const relatedSections = this.renderRelatedSections(context);
    const functionalRulesSection = this.renderFunctionalRulesSection(context);

    const locationLine =
      options.testNamespace && options.testPath
        ? `El archivo debe estar en ${options.testPath} y declarar el namespace ${options.testNamespace}.`
        : options.testNamespace
          ? `El archivo debe declarar el namespace ${options.testNamespace}.`
          : null;

    const sections = [
      'Eres un ingeniero de software senior escribiendo pruebas unitarias en PHP.',
      `Objetivo: escribir una prueba unitaria para ${targetKind} "${targetLabel}" en ${context.target.filePath}.`,
      'Usa PHPUnit 11 como framework de pruebas. Escribe un archivo PHP completo: debe empezar con `<?php`, puede declarar `declare(strict_types=1);`, declarar el namespace del test y usar `use` con el namespace completo de cada clase del proyecto que necesites.',
      'Extiende `Tests\\TestCase` solo si el código objetivo usa el contenedor de Laravel (helpers como `config()` o `app()`, o facades `Illuminate\\Support\\Facades\\...`). Si no lo usa, extiende `PHPUnit\\Framework\\TestCase`.',
      locationLine,
      'Código objetivo:',
      '```php',
      context.target.content,
      '```',
      functionalRulesSection,
      relatedSections.length > 0 ? `Contexto relacionado del mismo proyecto:\n${relatedSections}` : null,
      'Responde ÚNICAMENTE con código PHP válido, empezando por `<?php`. No incluyas explicaciones ni comentarios de proceso. No envuelvas la respuesta en fences de markdown.',
    ];

    return sections.filter((section): section is string => section !== null).join('\n\n');
  }

  private renderRelatedSections(context: GenerationContext): string {
    return context.relatedChunks
      .map((chunk) => {
        const label = chunk.parentSymbolName
          ? `${chunk.parentSymbolName}.${chunk.symbolName}`
          : (chunk.symbolName ?? '(archivo completo)');

        return `--- ${chunk.filePath} (${chunk.symbolKind} ${label}) ---\n${chunk.content}`;
      })
      .join('\n\n');
  }

  // Bloque separado del código: son decisiones funcionales aprobadas, no fragmentos del repositorio.
  private renderFunctionalRulesSection(context: GenerationContext): string | null {
    return context.functionalRules.length > 0
      ? `Reglas funcionales (conocimiento aprobado del proyecto; no son código):\n${context.functionalRules
          .map(renderFunctionalRule)
          .join('\n')}`
      : null;
  }
}
