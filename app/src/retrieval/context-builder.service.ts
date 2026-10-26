import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RetrievalResult } from './retrieval.service.js';
import type {
  ContextChunk,
  FunctionalRule,
  GenerationContextDependencyContext,
  GenerationContextAuditCandidate,
  GenerationContextAuditFunctionalRuleOmission,
  GenerationContext,
  RagContextLayer,
  RagContextStrategy,
  RetrievalTarget,
  StructuralMatch,
} from './generation-context.js';
import { countFunctionalRuleTokens } from './functional-rule-format.js';
import { DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS } from '../config/generation-budget.defaults.js';
import { isTestFile } from '../project-versions/indexing.constants.js';

export interface ContextBuilderOptions {
  minimumScore?: number;
  topK?: number;
  maxContextTokens?: number;
  semanticWeight?: number;
  structuralWeight?: number;
  /** WI-CORE-103. Solo `LAYERED` con proyectos PHP; cualquier otro lenguaje usa `RANKED`. */
  strategy?: RagContextStrategy;
  relevanceThreshold?: number;
  declaringClassMaxTokens?: number;
  targetEvidenceMaxTokens?: number;
}

interface ResolvedConfig {
  minimumScore: number;
  topK: number;
  maxContextTokens: number;
  semanticWeight: number;
  structuralWeight: number;
  strategy: RagContextStrategy;
  relevanceThreshold: number;
  declaringClassMaxTokens: number;
  targetEvidenceMaxTokens: number;
}

/** Pesos del score combinado `semanticWeight·semántico + structuralWeight·estructural` (WI-CORE-022). */
export interface ScoringWeights {
  semanticWeight: number;
  structuralWeight: number;
}

const DEFAULT_MINIMUM_SCORE = 0;
const DEFAULT_TOP_K = 10;
const DEFAULT_SEMANTIC_WEIGHT = 0.7;
const DEFAULT_STRUCTURAL_WEIGHT = 0.3;
const DEFAULT_CONTEXT_STRATEGY: RagContextStrategy = 'LAYERED';
const DEFAULT_RELEVANCE_THRESHOLD = 0.6;
const DEFAULT_DECLARING_CLASS_MAX_TOKENS = 4000;
const DEFAULT_TARGET_EVIDENCE_MAX_TOKENS = 2000;

/** Relaciones estructurales que alimentan la capa de evidencia del target (`IMPORTED_BY` queda fuera). */
const TARGET_EVIDENCE_MATCHES: ReadonlySet<StructuralMatch> = new Set([
  'IMPORTS',
  'FULLY_QUALIFIED_REFERENCE',
  'SAME_NAMESPACE',
]);

@Injectable()
export class ContextBuilder {
  constructor(private readonly configService: ConfigService) {}

  build(
    result: RetrievalResult,
    target: RetrievalTarget,
    metadata: {
      framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null;
      language?: 'typescript' | 'php';
    },
    options: ContextBuilderOptions = {},
    functionalRules: FunctionalRule[] = [],
    dependencyContext?: GenerationContextDependencyContext | null,
  ): GenerationContext {
    const resolved = this.resolveConfig(options);
    // LAYERED es PHP; TypeScript (o `language` ausente) conserva RANKED y la traza registra la efectiva.
    const config: ResolvedConfig = {
      ...resolved,
      strategy: metadata.language === 'php' ? resolved.strategy : 'RANKED',
    };
    const layered = config.strategy === 'LAYERED';
    const targetContent = result.targetChunks
      .map((chunk) => chunk.content)
      .join('\n\n');
    const targetTokens = result.targetChunks.reduce(
      (sum, chunk) => sum + (chunk.tokenCount ?? 0),
      0,
    );

    const ranked = result.candidates
      .map((candidate) => {
        const score = this.scoreCandidate(
          config,
          candidate.semanticScore,
          candidate.structuralMatch,
        );
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
    const topKEntries = layered ? [] : eligible.slice(0, config.topK);
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
      } else if (layered) {
        // Las capas deciden cada candidato elegible más abajo; todos acaban con motivo o selección.
        discardReason = null;
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
        layer: null,
      };
      decisions.set(entry, traceCandidate);
      return traceCandidate;
    });

    // Reglas funcionales antes que los chunks: se cuentan con el mismo tokenizador y en el orden
    // recibido (createdAt, knowledgeId). Las que no caben se omiten y constan en audit.
    const selectedRules: FunctionalRule[] = [];
    const omittedRules: GenerationContextAuditFunctionalRuleOmission[] = [];
    let contextTokens = targetTokens;
    let functionalRuleTokens = 0;

    for (const rule of functionalRules) {
      const tokenCount = countFunctionalRuleTokens(rule);

      if (contextTokens + tokenCount > config.maxContextTokens) {
        omittedRules.push({
          knowledgeId: rule.knowledgeId,
          tokenCount,
          reason: 'TOKEN_BUDGET',
        });
        continue;
      }

      contextTokens += tokenCount;
      functionalRuleTokens += tokenCount;
      selectedRules.push(rule);
    }

    const relatedChunks: ContextChunk[] = [];

    const appendChunk = (
      entry: (typeof ranked)[number],
      tokenCount: number,
      layer: RagContextLayer | null,
    ): void => {
      const traceCandidate = decisions.get(entry);
      contextTokens += tokenCount;
      if (traceCandidate) {
        traceCandidate.decision = 'SELECTED';
        traceCandidate.discardReason = null;
        traceCandidate.layer = layer;
      }
      relatedChunks.push({
        filePath: entry.candidate.chunk.filePath,
        symbolKind: entry.candidate.chunk.symbolKind,
        symbolName: entry.candidate.chunk.symbolName,
        parentSymbolName: entry.candidate.chunk.parentSymbolName,
        content: entry.candidate.chunk.content,
        score: entry.score,
        matchedVia: entry.matchedVia,
      });
    };
    const discard = (
      entry: (typeof ranked)[number],
      reason: NonNullable<GenerationContextAuditCandidate['discardReason']>,
    ): void => {
      const traceCandidate = decisions.get(entry);
      if (traceCandidate) {
        traceCandidate.decision = 'DISCARDED';
        traceCandidate.discardReason = reason;
        traceCandidate.layer = null;
      }
    };

    if (layered) {
      this.selectByLayers(eligible, config, {
        contextTokens: () => contextTokens,
        append: appendChunk,
        discard,
      });
    } else {
      for (const entry of topKEntries) {
        const tokenCount = entry.candidate.chunk.tokenCount ?? 0;

        if (contextTokens + tokenCount > config.maxContextTokens) {
          discard(entry, 'TOKEN_BUDGET');
          continue;
        }

        appendChunk(entry, tokenCount, null);
      }
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
      functionalRules: selectedRules,
      metadata: {
        language: metadata.language ?? 'typescript',
        framework: metadata.framework,
      },
      retrievedChunks: result.candidates.length,
      selectedChunks: relatedChunks.length,
      contextTokens,
      // No rankeado ni presupuestado: se copia tal cual, sin alterar selección ni contadores.
      ...(dependencyContext ? { dependencyContext } : {}),
      audit: {
        functionalRules: {
          retrieved: functionalRules.length,
          selected: selectedRules.length,
          tokenCount: functionalRuleTokens,
          omitted: omittedRules,
        },
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

  /**
   * Pesos vigentes del score combinado: los de `options` o, si faltan, `RETRIEVAL_SEMANTIC_WEIGHT` y
   * `RETRIEVAL_STRUCTURAL_WEIGHT` (defecto 0.7 / 0.3). API pública para la comparación de retrieval;
   * no cambia el orden ni la traza del producto.
   */
  resolveWeights(options: Pick<ContextBuilderOptions, 'semanticWeight' | 'structuralWeight'> = {}): ScoringWeights {
    return {
      semanticWeight:
        options.semanticWeight ??
        this.configService.get<number>('RETRIEVAL_SEMANTIC_WEIGHT', DEFAULT_SEMANTIC_WEIGHT),
      structuralWeight:
        options.structuralWeight ??
        this.configService.get<number>('RETRIEVAL_STRUCTURAL_WEIGHT', DEFAULT_STRUCTURAL_WEIGHT),
    };
  }

  /** Score combinado de un candidato con la fórmula del producto. Sin estructural, el boost es 0. */
  scoreCandidate(
    weights: ScoringWeights,
    semanticScore: number | null,
    structuralMatch: StructuralMatch | null,
  ): number {
    const semantic = semanticScore ?? 0;
    const structuralBoost = structuralMatch ? 1 : 0;

    return weights.semanticWeight * semantic + weights.structuralWeight * structuralBoost;
  }

  /**
   * Selección por capas (WI-CORE-103, solo PHP). `eligible` ya viene ordenado por score descendente y
   * filtrado por `minimumScore`. Capas: 3 clase declarante (por `startLine`), 4 evidencia del target
   * (sin archivos de prueba) y 5 relleno semántico con umbral y techo `topK`. Todas respetan
   * `maxContextTokens`; un candidato descartado por el tope de una capa no se reconsidera.
   */
  private selectByLayers<T extends { candidate: RetrievalResult['candidates'][number]; score: number }>(
    eligible: T[],
    config: ResolvedConfig,
    io: {
      contextTokens: () => number;
      append: (entry: T, tokenCount: number, layer: RagContextLayer) => void;
      discard: (
        entry: T,
        reason: 'BELOW_RELEVANCE_THRESHOLD' | 'TOP_K_LIMIT' | 'TOKEN_BUDGET',
      ) => void;
    },
  ): void {
    const decided = new Set<T>();
    const tokensOf = (entry: T): number => entry.candidate.chunk.tokenCount ?? 0;
    const fits = (entry: T, layerTokens: number, layerCap: number): boolean =>
      layerTokens + tokensOf(entry) <= layerCap &&
      io.contextTokens() + tokensOf(entry) <= config.maxContextTokens;

    const runCappedLayer = (
      entries: T[],
      layer: RagContextLayer,
      layerCap: number,
    ): void => {
      let layerTokens = 0;
      for (const entry of entries) {
        decided.add(entry);
        if (!fits(entry, layerTokens, layerCap)) {
          io.discard(entry, 'TOKEN_BUDGET');
          continue;
        }
        layerTokens += tokensOf(entry);
        io.append(entry, tokensOf(entry), layer);
      }
    };

    // Capa 3: clase declarante, cabecera/propiedades/constructor primero.
    const declaring = eligible
      .filter((entry) => entry.candidate.structuralMatch === 'DECLARING_CLASS')
      .sort((a, b) => {
        const left = a.candidate.chunk;
        const right = b.candidate.chunk;
        if (left.startLine !== right.startLine) return left.startLine - right.startLine;
        if (left.endLine !== right.endLine) return left.endLine - right.endLine;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
    runCappedLayer(declaring, 'DECLARING_CLASS', config.declaringClassMaxTokens);

    // Capa 4: evidencia del target (imports, FQCN, mismo namespace), fuera archivos de prueba.
    const evidence = eligible.filter(
      (entry) =>
        !decided.has(entry) &&
        !isTestFile(entry.candidate.chunk.filePath) &&
        entry.candidate.structuralMatch !== null &&
        TARGET_EVIDENCE_MATCHES.has(entry.candidate.structuralMatch),
    );
    runCappedLayer(evidence, 'TARGET_EVIDENCE', config.targetEvidenceMaxTokens);

    // Capa 5: relleno semántico por umbral, con `topK` como techo.
    let filled = 0;
    for (const entry of eligible) {
      if (decided.has(entry)) continue;
      decided.add(entry);
      const semanticScore = entry.candidate.semanticScore;
      if (semanticScore === null || semanticScore < config.relevanceThreshold) {
        io.discard(entry, 'BELOW_RELEVANCE_THRESHOLD');
      } else if (filled >= config.topK) {
        io.discard(entry, 'TOP_K_LIMIT');
      } else if (io.contextTokens() + tokensOf(entry) > config.maxContextTokens) {
        io.discard(entry, 'TOKEN_BUDGET');
      } else {
        filled += 1;
        io.append(entry, tokensOf(entry), 'RELEVANT_SEMANTIC');
      }
    }
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
          DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS,
        ),
      ...this.resolveWeights(options),
      strategy:
        options.strategy ??
        (this.configService.get<string>(
          'RETRIEVAL_CONTEXT_STRATEGY',
          DEFAULT_CONTEXT_STRATEGY,
        ) === 'RANKED'
          ? 'RANKED'
          : 'LAYERED'),
      relevanceThreshold:
        options.relevanceThreshold ??
        this.configService.get<number>(
          'RETRIEVAL_RELEVANCE_THRESHOLD',
          DEFAULT_RELEVANCE_THRESHOLD,
        ),
      declaringClassMaxTokens:
        options.declaringClassMaxTokens ??
        this.configService.get<number>(
          'RETRIEVAL_DECLARING_CLASS_MAX_TOKENS',
          DEFAULT_DECLARING_CLASS_MAX_TOKENS,
        ),
      targetEvidenceMaxTokens:
        options.targetEvidenceMaxTokens ??
        this.configService.get<number>(
          'RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS',
          DEFAULT_TARGET_EVIDENCE_MAX_TOKENS,
        ),
    };
  }
}
