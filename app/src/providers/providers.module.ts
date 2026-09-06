import { Global, Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './providers.constants.js';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider.js';
import { OpenAiLLMProvider } from './openai-llm.provider.js';

@Global()
@Module({
  providers: [
    { provide: EMBEDDING_PROVIDER, useClass: OpenAiEmbeddingProvider },
    { provide: LLM_PROVIDER, useClass: OpenAiLLMProvider },
  ],
  exports: [EMBEDDING_PROVIDER, LLM_PROVIDER],
})
export class ProvidersModule {}
