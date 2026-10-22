import type { ConfigService } from '@nestjs/config';
import { REASONING_EFFORT_SCALE } from './reasoning-effort.scale.js';

/** Modelo por defecto del LLM (WI-CORE-076): el mismo para el flujo normal y para los experimentos. */
export const DEFAULT_LLM_MODEL = 'gpt-6-luna';

/** Configuración única del LLM: modelo y esfuerzo que usan el flujo normal y los experimentos. */
export interface LlmSettings {
  model: string;
  reasoningEffort: string;
}

/**
 * Resolución única de `LLM_MODEL` y `LLM_REASONING_EFFORT` (WI-CORE-076, DEC-EXP-005). El arranque
 * (`validateEnv`) ya exige un esfuerzo válido; aquí se vuelve a comprobar para que nunca se envíe
 * a la API un valor vacío o fuera de la escala.
 */
export function resolveLlmSettings(configService: ConfigService): LlmSettings {
  const model = configService.get<string>('LLM_MODEL', DEFAULT_LLM_MODEL);
  const reasoningEffort = (configService.get<string>('LLM_REASONING_EFFORT') ?? '').trim();
  if (!REASONING_EFFORT_SCALE.includes(reasoningEffort)) {
    throw new Error(
      'LLM_REASONING_EFFORT no tiene un esfuerzo válido; el arranque debía haberlo rechazado (WI-CORE-076).',
    );
  }
  return { model, reasoningEffort };
}
