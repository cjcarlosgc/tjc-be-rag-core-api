import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Cliente OpenAI compartido por EmbeddingProvider, LLMProvider y el agente
 * generalista: mismo timeout/retry policy configurable (`OPENAI_TIMEOUT_MS`,
 * `OPENAI_MAX_RETRIES`), sin acoplar cada provider a los defaults del SDK.
 */
export function createOpenAiClient(configService: ConfigService): OpenAI {
  return new OpenAI({
    apiKey: configService.get<string>('OPENAI_API_KEY'),
    timeout: configService.get<number>('OPENAI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: configService.get<number>('OPENAI_MAX_RETRIES', DEFAULT_MAX_RETRIES),
  });
}
