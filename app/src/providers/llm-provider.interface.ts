export interface LLMGenerationResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMProvider {
  generate(prompt: string): Promise<LLMGenerationResult>;
}
