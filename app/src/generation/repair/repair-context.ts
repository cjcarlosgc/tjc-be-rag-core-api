import type { GenerationContext } from '../../retrieval/generation-context.js';
import type { FailureTypeValue } from '../../sandbox/map-sandbox-result.js';
import type { RunnerFacts } from '../../sandbox/sandbox.types.js';

/**
 * Evidencia que recibe el LLM para corregir una prueba que falló en el
 * Sandbox: el test que se generó (failedTestContent), el fallo reportado
 * (failureType/errorSummary), los hechos crudos del runner (runnerFacts,
 * incluye stdout/stderr relevante por caso vía TestCaseFact.errorMessage) y
 * el contexto original de generación (generationContext), para no perder el
 * objetivo/relacionados usados en el intento inicial.
 */
export interface RepairContext {
  generationContext: GenerationContext;
  failedTestContent: string;
  failureType: FailureTypeValue;
  errorSummary: string | null;
  runnerFacts: RunnerFacts | null;
  attempt: number;
}
