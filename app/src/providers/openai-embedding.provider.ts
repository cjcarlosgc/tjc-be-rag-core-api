import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { EmbeddingProvider } from './embedding-provider.interface.js';

const BATCH_SIZE = 96;

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  async embedMany(texts: string[]): Promise<number[][]> {
    const client = this.getClient();
    const model = this.configService.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensions = this.configService.get<number>('EMBEDDING_DIMENSIONS', 1536);
    const results: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const response = await client.embeddings.create({ model, input: batch, dimensions });

      for (const item of response.data) {
        results[offset + item.index] = item.embedding;
      }
    }

    return results;
  }

  private getClient(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.configService.get<string>('OPENAI_API_KEY') });
    return this.client;
  }
}
