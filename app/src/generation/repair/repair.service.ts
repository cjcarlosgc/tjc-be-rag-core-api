import { Inject, Injectable } from '@nestjs/common';
import { PromptBuilder } from '../prompt-builder.service.js';
import { LLM_PROVIDER } from '../../providers/providers.constants.js';
import type { LLMGenerationResult, LLMProvider } from '../../providers/llm-provider.interface.js';
import type { RepairContext } from './repair-context.js';

/**
 * Separado del generation first-shot (`TestGenerationJobHandler` sí lo usa,
 * `ExperimentJobHandler` deliberadamente no lo referencia: la autorreparación
 * nunca se activa durante las corridas experimentales de HU19).
 */
@Injectable()
export class RepairService {
  constructor(
    private readonly promptBuilder: PromptBuilder,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LLMProvider,
  ) {}

  repair(context: RepairContext): Promise<LLMGenerationResult> {
    const prompt = this.promptBuilder.buildRepair(context);
    return this.llmProvider.generate(prompt);
  }
}
