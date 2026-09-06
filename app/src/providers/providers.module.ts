import { Global, Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER } from './providers.constants.js';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider.js';

@Global()
@Module({
  providers: [{ provide: EMBEDDING_PROVIDER, useClass: OpenAiEmbeddingProvider }],
  exports: [EMBEDDING_PROVIDER],
})
export class ProvidersModule {}
