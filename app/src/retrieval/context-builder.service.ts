import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RetrievalResult } from './retrieval.service.js';
import type {
  ContextChunk,
  GenerationContextAuditCandidate,
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
    const targetContent = result.targetChunks
      .map((chunk) => chunk.content)
      .join('\n\n');
    const targetTokens = result.targetChunks.reduce(
      (sum, chunk) => sum + (chunk.tokenCount ?? 0),
      0,
    );

    const ranked = result.candidates
      .map((candidate) => {
        const semantic = candidate.semanticScore ?? 0;
        const structuralBoost = candidate.structuralMatch ? 1 : 0;
        const score =
          config.semanticWeight * semantic +
          config.structuralWeight * structuralBoost;
        const matchedVia: ContextChunk['matchedVia'] = [];

        if (candidate.semanticScore !== null) {
          matchedVia.push('SEMANTIC');
        }

        if (candidate.structuralMatch) {
          matchedVia.push(candidate.structuralMatch as StructuralMatch);
        }

        return { candidate, score, matchedVia };
      })
      .sort((a, b) => b.score - a.score);
    // Sorting all candidates is equivalent to the previous filter-then-sort
    // order for eligible candidates because every below-threshold score is
    // less than every score that passes the configured minimum.
    const eligible = ranked.filter(
      (entry) => entry.score >= config.minimumScore,
    );
    const topKEntries = eligible.slice(0, config.topK);
    const topKSet = new Set(topKEntries);
    const decisions = new Map<
      (typeof ranked)[number],
      GenerationContextAuditCandidate
    >();

    const auditCandidates = ranked.map((entry, index) => {
      const tokenCount = entry.candidate.chunk.tokenCount ?? 0;
      let decision: GenerationContextAuditCandidate['decision'] = 'DISCARDED';
      let discardReason: GenerationContextAuditCandidate['discardReason'] =
        null;

      if (entry.score < config.minimumScore) {
        discardReason = 'BELOW_MINIMUM_SCORE';
      } else if (!topKSet.has(entry)) {
        discardReason = 'TOP_K_LIMIT';
      } else {
        // The budget pass below determines selection. Until then, this is a
        // candidate that reached the prompt-building stage.
        decision = 'SELECTED';
      }

      const traceCandidate: GenerationContextAuditCandidate = {
        chunkId: entry.candidate.chunk.id,
        filePath: entry.candidate.chunk.filePath,
        symbolKind: entry.candidate.chunk.symbolKind,
        symbolName: entry.candidate.chunk.symbolName,
        parentSymbolName: entry.candidate.chunk.parentSymbolName,
        startLine: entry.candidate.chunk.startLine,
        endLine: entry.candidate.chunk.endLine,
        content: entry.candidate.chunk.content,
        tokenCount,
        rank: index + 1,
        semanticScore: entry.candidate.semanticScore,
        structuralMatch: entry.candidate.structuralMatch,
        combinedScore: entry.score,
        matchedVia: entry.matchedVia,
        decision,
        discardReason,
      };
      decisions.set(entry, traceCandidate);
      return traceCandidate;
    });

    const relatedChunks: ContextChunk[] = [];
    let contextTokens = targetTokens;

    for (const entry of topKEntries) {
      const tokenCount = entry.candidate.chunk.tokenCount ?? 0;
      const traceCandidate = decisions.get(entry);

      if (contextTokens + tokenCount > config.maxContextTokens) {
        if (traceCandidate) {
          traceCandidate.decision = 'DISCARDED';
          traceCandidate.discardReason = 'TOKEN_BUDGET';
        }
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
      audit: {
        target: {
          chunkIds: result.targetChunks.map((chunk) => chunk.id),
          chunks: result.targetChunks.map((chunk) => ({
            chunkId: chunk.id,
            filePath: chunk.filePath,
            symbolKind: chunk.symbolKind,
            symbolName: chunk.symbolName,
            parentSymbolName: chunk.parentSymbolName,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
            tokenCount: chunk.tokenCount ?? 0,
          })),
          tokenCount: targetTokens,
        },
        candidates: auditCandidates,
        configuration: config,
      },
    };
  }

  private resolveConfig(options: ContextBuilderOptions): ResolvedConfig {
    return {
      minimumScore:
        options.minimumScore ??
        this.configService.get<number>(
          'RETRIEVAL_MINIMUM_SCORE',
          DEFAULT_MINIMUM_SCORE,
        ),
      topK:
        options.topK ??
        this.configService.get<number>('RETRIEVAL_TOP_K', DEFAULT_TOP_K),
      maxContextTokens:
        options.maxContextTokens ??
        this.configService.get<number>(
          'RETRIEVAL_MAX_CONTEXT_TOKENS',
          DEFAULT_MAX_CONTEXT_TOKENS,
        ),
      semanticWeight:
        options.semanticWeight ??
        this.configService.get<number>(
          'RETRIEVAL_SEMANTIC_WEIGHT',
          DEFAULT_SEMANTIC_WEIGHT,
        ),
      structuralWeight:
        options.structuralWeight ??
        this.configService.get<number>(
          'RETRIEVAL_STRUCTURAL_WEIGHT',
          DEFAULT_STRUCTURAL_WEIGHT,
        ),
    };
  }
}
