import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { LLMGenerationResult, LLMProvider } from './llm-provider.interface.js';
import { createOpenAiClient } from './openai-client.factory.js';

@Injectable()
export class OpenAiLLMProvider implements LLMProvider {
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  async generate(prompt: string): Promise<LLMGenerationResult> {
    const client = this.getClient();
    const model = this.configService.get<string>('LLM_MODEL', 'gpt-4o-mini');
    const reasoningEffort = this.configService.get<string>('LLM_REASONING_EFFORT');

    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [{ role: 'user', content: prompt }],
      ...(reasoningEffort
        ? { reasoning_effort: reasoningEffort as ChatCompletionCreateParamsNonStreaming['reasoning_effort'] }
        : {}),
    };

    try {
      const response = await client.chat.completions.create(params);

      return {
        content: response.choices[0]?.message?.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      throw new AppException(
        ErrorCode.LLM_PROVIDER_UNAVAILABLE,
        'El proveedor de LLM no respondió correctamente.',
        HttpStatus.SERVICE_UNAVAILABLE,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private getClient(): OpenAI {
    this.client ??= createOpenAiClient(this.configService);
    return this.client;
  }
}
