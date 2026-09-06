import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { EmbeddingProvider } from './embedding-provider.interface.js';
import { createOpenAiClient } from './openai-client.factory.js';

const BATCH_SIZE = 96;

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  async embedMany(texts: string[]): Promise<number[][]> {
    const client = this.getClient();
    const model = this.configService.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensions = this.configService.get<number>('EMBEDDING_DIMENSIONS', 1536);
    const results: number[][] = [];
    let totalUsageTokens = 0;

    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const response = await client.embeddings.create({ model, input: batch, dimensions });

      for (const item of response.data) {
        results[offset + item.index] = item.embedding;
      }

      totalUsageTokens += response.usage?.total_tokens ?? 0;
    }

    this.logger.debug(`embedMany: ${texts.length} textos, ${totalUsageTokens} tokens (usage reportado por OpenAI).`);

    return results;
  }

  private getClient(): OpenAI {
    this.client ??= createOpenAiClient(this.configService);
    return this.client;
  }
}
