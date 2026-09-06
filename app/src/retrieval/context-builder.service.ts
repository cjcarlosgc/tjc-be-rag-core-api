import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RetrievalResult } from './retrieval.service.js';
import type {
  ContextChunk,
  GenerationContext,
  RetrievalTarget,
  StructuralMatch,
} from './generation-context.js';

export interface ContextBuilderOptions {
  minimumScore?: number;
  topK?: number;
  maxContextTokens?: number;
  semanticWeight?: number;
  structuralWeight?: number;
}

interface ResolvedConfig {
  minimumScore: number;
  topK: number;
  maxContextTokens: number;
  semanticWeight: number;
  structuralWeight: number;
}

const DEFAULT_MINIMUM_SCORE = 0;
const DEFAULT_TOP_K = 10;
const DEFAULT_MAX_CONTEXT_TOKENS = 6000;
const DEFAULT_SEMANTIC_WEIGHT = 0.7;
const DEFAULT_STRUCTURAL_WEIGHT = 0.3;

@Injectable()
export class ContextBuilder {
  constructor(private readonly configService: ConfigService) {}

  build(
    result: RetrievalResult,
    target: RetrievalTarget,
    metadata: { framework: 'JEST' | 'VITEST' | null },
    options: ContextBuilderOptions = {},
  ): GenerationContext {
    const config = this.resolveConfig(options);
    const targetContent = result.targetChunks.map((chunk) => chunk.content).join('\n\n');
    const targetTokens = result.targetChunks.reduce((sum, chunk) => sum + (chunk.tokenCount ?? 0), 0);

    const ranked = result.candidates
      .map((candidate) => {
        const semantic = candidate.semanticScore ?? 0;
        const structuralBoost = candidate.structuralMatch ? 1 : 0;
        const score =
          config.semanticWeight * semantic + config.structuralWeight * structuralBoost;
        const matchedVia: ContextChunk['matchedVia'] = [];

        if (candidate.semanticScore !== null) {
          matchedVia.push('SEMANTIC');
        }

        if (candidate.structuralMatch) {
          matchedVia.push(candidate.structuralMatch as StructuralMatch);
        }

        return { candidate, score, matchedVia };
      })
      .filter((entry) => entry.score >= config.minimumScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.topK);

    const relatedChunks: ContextChunk[] = [];
    let contextTokens = targetTokens;

    for (const entry of ranked) {
      const tokenCount = entry.candidate.chunk.tokenCount ?? 0;

      if (contextTokens + tokenCount > config.maxContextTokens) {
        continue;
      }

      contextTokens += tokenCount;
      relatedChunks.push({
        filePath: entry.candidate.chunk.filePath,
        symbolKind: entry.candidate.chunk.symbolKind,
        symbolName: entry.candidate.chunk.symbolName,
        parentSymbolName: entry.candidate.chunk.parentSymbolName,
        content: entry.candidate.chunk.content,
        score: entry.score,
        matchedVia: entry.matchedVia,
      });
    }

    return {
      target: {
        filePath: target.filePath,
        symbolName: target.symbolName,
        methodName: target.methodName,
        targetType: target.targetType,
        content: targetContent,
      },
      relatedChunks,
      metadata: { language: 'typescript', framework: metadata.framework },
      retrievedChunks: result.candidates.length,
      selectedChunks: relatedChunks.length,
      contextTokens,
    };
  }

  private resolveConfig(options: ContextBuilderOptions): ResolvedConfig {
    return {
      minimumScore:
        options.minimumScore ??
        this.configService.get<number>('RETRIEVAL_MINIMUM_SCORE', DEFAULT_MINIMUM_SCORE),
      topK: options.topK ?? this.configService.get<number>('RETRIEVAL_TOP_K', DEFAULT_TOP_K),
      maxContextTokens:
        options.maxContextTokens ??
        this.configService.get<number>('RETRIEVAL_MAX_CONTEXT_TOKENS', DEFAULT_MAX_CONTEXT_TOKENS),
      semanticWeight:
        options.semanticWeight ??
        this.configService.get<number>('RETRIEVAL_SEMANTIC_WEIGHT', DEFAULT_SEMANTIC_WEIGHT),
      structuralWeight:
        options.structuralWeight ??
        this.configService.get<number>(
          'RETRIEVAL_STRUCTURAL_WEIGHT',
          DEFAULT_STRUCTURAL_WEIGHT,
        ),
    };
  }
}
