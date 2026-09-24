import { HttpStatus, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Page } from '../common/dto/page.response.js';
import type {
  ListContextTracesQueryDto,
  ListDiscoveredFilesQueryDto,
} from '../experiments/dto/context-traces-query.dto.js';
import type {
  AgentContextTraceDetailResponse,
  AgentObservationResponse,
  ContextTraceDetailResponse,
  ContextTraceSummaryResponse,
  DiscoveredFileResponse,
  RagCandidateNodeResponse,
  RagContextTraceDetailResponse,
  RagDiscardReason,
  RagTargetNodeResponse,
  SourceExcerptResponse,
  SourceLineResponse,
} from '../experiments/dto/context-trace.response.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { ExperimentStatus } from '../generated/prisma/enums.js';
import { ZipExtractionService } from '../project-versions/zip/zip-extraction.service.js';
import { ContextTraceReadsRepository } from './context-trace-reads.repository.js';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_EXCERPT_CHARS = 4000;

interface StoredExcerpt {
  filePath: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  snippet: string;
  contentSha256: string;
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !isAbsolute(filePath) &&
    !/^[a-zA-Z]:\//.test(filePath) &&
    !filePath.includes('\\') &&
    !filePath
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function invalidStoredDetail(): AppException {
  return new AppException(
    ErrorCode.INTERNAL_ERROR,
    'La evidencia de contexto no tiene un formato válido.',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function isRagDiscardReason(value: unknown): value is RagDiscardReason {
  return (
    value === 'BELOW_MINIMUM_SCORE' ||
    value === 'TOP_K_LIMIT' ||
    value === 'TOKEN_BUDGET'
  );
}

function safeStoredExcerpt(value: unknown): StoredExcerpt {
  if (!isRecord(value)) {
    throw invalidStoredDetail();
  }

  const filePath = typeof value.filePath === 'string' ? value.filePath : '';
  if (!isSafeRelativePath(filePath)) {
    throw invalidStoredDetail();
  }

  const contentSha256 =
    typeof value.contentSha256 === 'string' ? value.contentSha256 : '';
  const snippet = typeof value.snippet === 'string' ? value.snippet : null;
  const truncated = value.truncated;
  const startLine = value.startLine === null ? null : value.startLine;
  const endLine = value.endLine === null ? null : value.endLine;
  if (
    snippet === null ||
    !/^[a-f0-9]{64}$/i.test(contentSha256) ||
    typeof truncated !== 'boolean' ||
    (startLine !== null &&
      (!Number.isSafeInteger(startLine) || (startLine as number) < 1)) ||
    (endLine !== null &&
      (!Number.isSafeInteger(endLine) || (endLine as number) < 1)) ||
    (startLine === null) !== (endLine === null) ||
    (startLine !== null &&
      endLine !== null &&
      (endLine as number) < (startLine as number))
  ) {
    throw invalidStoredDetail();
  }

  return {
    filePath,
    symbolName: typeof value.symbolName === 'string' ? value.symbolName : null,
    parentSymbolName:
      typeof value.parentSymbolName === 'string'
        ? value.parentSymbolName
        : null,
    startLine: startLine as number | null,
    endLine: endLine as number | null,
    snippet: snippet.slice(0, MAX_EXCERPT_CHARS),
    contentSha256: contentSha256.toLowerCase(),
    truncated: truncated || snippet.length > MAX_EXCERPT_CHARS,
  };
}

function summary(trace: {
  id: string;
  kind: 'RAG' | 'AGENT';
  projectVersionId: string;
  targetId: string;
  experimentId: string;
  strategy: 'RAG' | 'GENERALIST_AGENT';
  repetition: number;
  attempt: number;
  current: boolean;
  createdAt: Date;
}): ContextTraceSummaryResponse {
  return {
    id: trace.id,
    kind: trace.kind,
    projectVersionId: trace.projectVersionId,
    targetId: trace.targetId,
    testRunId: null,
    experimentId: trace.experimentId,
    strategy: trace.strategy,
    repetition: trace.repetition as 1 | 2 | 3,
    attempt: trace.attempt,
    current: trace.current,
    artifactIds: [],
    createdAt: trace.createdAt.toISOString(),
  };
}

@Injectable()
export class ContextTracesService {
  constructor(
    private readonly reads: ContextTraceReadsRepository,
    private readonly objectStorage: ObjectStorageService,
    private readonly zipExtraction: ZipExtractionService,
  ) {}

  async listContextTraces(
    experimentId: string,
    userId: string,
    query: ListContextTracesQueryDto,
  ): Promise<Page<ContextTraceSummaryResponse>> {
    const experiment = await this.reads.findExperimentForOwner(
      experimentId,
      userId,
    );
    if (!experiment) {
      throw new AppException(
        ErrorCode.EXPERIMENT_NOT_FOUND,
        `No existe el experimento ${experimentId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const take = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.reads.listForExperiment({
      experimentId,
      userId,
      strategy: query.strategy,
      repetition: query.repetition,
      includeSuperseded: query.includeSuperseded ?? false,
      cursor: query.cursor,
      take,
    });
    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, take) : rows).map(summary);
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async getContextTraceDetail(
    traceId: string,
    userId: string,
  ): Promise<ContextTraceDetailResponse> {
    const trace = await this.reads.findForOwner(traceId, userId);
    if (!trace) this.throwTraceNotFound();
    this.assertExperimentFinished(trace.experiment.status);

    if (trace.kind === 'RAG' && !isRecord(trace.detail)) {
      // INTEROP requires a target and effective configuration on every RAG detail. If
      // retrieval failed before those facts existed, a successful DTO would fabricate evidence.
      // Keep this fail-closed until contract review defines terminal traces without evidence.
      throw invalidStoredDetail();
    }

    const stored = isRecord(trace.detail) ? trace.detail : {};
    const excerpts = this.collectExcerpts(trace.kind, stored);
    const lineContext = await this.readLineContext(
      trace.projectVersion.snapshotKey,
      excerpts,
    );
    const base = summary(trace);

    if (trace.kind === 'RAG') {
      const target = isRecord(stored.target) ? stored.target : {};
      const candidates = Array.isArray(stored.candidates)
        ? stored.candidates
        : [];
      const detail: RagContextTraceDetailResponse = {
        ...base,
        kind: 'RAG',
        target: this.mapTarget(target, lineContext),
        candidates: candidates.map((candidate) =>
          this.mapCandidate(candidate, lineContext),
        ),
        retrievedChunks: this.requireNonNegativeInteger(stored.retrievedChunks),
        selectedChunks: this.requireNonNegativeInteger(stored.selectedChunks),
        contextTokens: this.requireNonNegativeInteger(stored.contextTokens),
        configuration: this.mapConfiguration(stored.configuration),
      };
      return detail;
    }

    const trajectory = this.agentTrajectory(trace.detail, stored);
    const detail: AgentContextTraceDetailResponse = {
      ...base,
      kind: 'AGENT',
      trajectory: trajectory.map((rawStep) => {
        const step = isRecord(rawStep) ? rawStep : {};
        const observations = Array.isArray(step.observations)
          ? step.observations
          : [];
        return {
          step: this.requirePositiveInteger(step.step),
          toolName: this.toolName(step.toolName),
          arguments: this.requireRecord(step.arguments),
          status: this.stepStatus(step.status),
          resultSummary: this.requireString(step.resultSummary),
          resultSha256: this.requireSha256(step.resultSha256),
          truncated: this.requireBoolean(step.truncated),
          observations: observations.map((rawObservation) =>
            this.mapObservation(rawObservation, lineContext),
          ),
        };
      }),
      toolCalls: this.requireNonNegativeInteger(trace.toolCalls),
      filesInspected: this.requireNonNegativeInteger(trace.filesInspected),
    };
    return detail;
  }

  async listDiscoveredFiles(
    traceId: string,
    userId: string,
    query: ListDiscoveredFilesQueryDto,
  ): Promise<Page<DiscoveredFileResponse>> {
    const trace = await this.reads.findForOwner(traceId, userId);
    if (!trace) this.throwTraceNotFound();
    this.assertExperimentFinished(trace.experiment.status);
    if (trace.kind !== 'AGENT') {
      throw new AppException(
        ErrorCode.INVALID_REQUEST,
        'Los archivos descubiertos solo están disponibles para trazas AGENT.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const stored = isRecord(trace.detail) ? trace.detail : {};
    const steps = this.agentTrajectory(trace.detail, stored);
    const listFileSteps = steps
      .filter((item) => isRecord(item) && item.toolName === 'list_files')
      .map((item) =>
        this.requirePositiveInteger((item as Record<string, unknown>).step),
      );
    if (query.step !== undefined && !listFileSteps.includes(query.step)) {
      throw new AppException(
        ErrorCode.INVALID_REQUEST,
        'El paso indicado no corresponde a una llamada list_files de esta traza.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const take = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.reads.listDiscoveredFilesForOwner(
      traceId,
      userId,
      query.step,
      query.cursor,
      take,
    );
    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, take) : rows).map(({ filePath }) => {
      if (!isSafeRelativePath(filePath)) throw invalidStoredDetail();
      return { filePath };
    });
    return {
      items,
      nextCursor: hasMore ? (rows[take - 1]?.id ?? null) : null,
    };
  }

  private throwTraceNotFound(): never {
    throw new AppException(
      ErrorCode.CONTEXT_TRACE_NOT_FOUND,
      'No existe una traza de contexto visible.',
      HttpStatus.NOT_FOUND,
    );
  }

  private assertExperimentFinished(status: ExperimentStatus): void {
    if (
      status !== ExperimentStatus.COMPLETED &&
      status !== ExperimentStatus.FAILED
    ) {
      throw new AppException(
        ErrorCode.CONTEXT_TRACE_NOT_FINISHED,
        'La traza estará disponible cuando termine el experimento.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private collectExcerpts(
    kind: 'RAG' | 'AGENT',
    stored: Record<string, unknown>,
  ): StoredExcerpt[] {
    if (kind === 'RAG') {
      const target = this.requireRecord(stored.target);
      const targetExcerpt = target.excerpt
        ? [safeStoredExcerpt(target.excerpt)]
        : [];
      if (!Array.isArray(stored.candidates)) throw invalidStoredDetail();
      const candidates = stored.candidates;
      return [
        ...targetExcerpt,
        ...candidates
          .filter((item) => isRecord(item) && item.excerpt)
          .map((item) =>
            safeStoredExcerpt((item as Record<string, unknown>).excerpt),
          ),
      ];
    }

    const trajectory = Array.isArray(stored.trajectory)
      ? stored.trajectory
      : [];
    return trajectory.flatMap((rawStep) => {
      if (!isRecord(rawStep) || !Array.isArray(rawStep.observations)) return [];
      return rawStep.observations.flatMap((rawObservation) => {
        if (!isRecord(rawObservation) || !rawObservation.excerpt) return [];
        return [safeStoredExcerpt(rawObservation.excerpt)];
      });
    });
  }

  private agentTrajectory(
    traceDetail: unknown,
    stored: Record<string, unknown>,
  ): unknown[] {
    // A null Agent detail means workspace acquisition failed before any tool call. The
    // persisted counters remain zero, so an empty trajectory is the faithful observation.
    if (traceDetail === null) return [];
    if (!Array.isArray(stored.trajectory)) throw invalidStoredDetail();
    return stored.trajectory;
  }

  private async readLineContext(
    snapshotKey: string | null,
    excerpts: StoredExcerpt[],
  ): Promise<
    Map<string, { before: SourceLineResponse[]; after: SourceLineResponse[] }>
  > {
    const context = new Map<
      string,
      { before: SourceLineResponse[]; after: SourceLineResponse[] }
    >();
    const relevant = excerpts.filter(
      (excerpt) => excerpt.startLine !== null && excerpt.endLine !== null,
    );
    if (relevant.length === 0) return context;
    if (!snapshotKey) this.throwSnapshotUnavailable();

    let workspace:
      Awaited<ReturnType<ZipExtractionService['extract']>> | undefined;
    try {
      const snapshot = await this.objectStorage.get(snapshotKey);
      workspace = await this.zipExtraction.extract(snapshot);
      const paths = new Set(relevant.map((excerpt) => excerpt.filePath));
      const linesByPath = new Map<string, string[]>();

      await Promise.all(
        [...paths].map(async (filePath) => {
          const safePath = join(workspace!.dir, ...filePath.split('/'));
          const relativePath = relative(workspace!.dir, safePath);
          if (relativePath.startsWith(`..${sep}`) || relativePath === '..')
            return;
          const content = await readFile(safePath, 'utf8').catch(() => null);
          if (content !== null)
            linesByPath.set(filePath, content.split(/\r?\n/));
        }),
      );

      for (const excerpt of relevant) {
        const lines = linesByPath.get(excerpt.filePath);
        const startLine = excerpt.startLine!;
        const endLine = excerpt.endLine!;
        if (!lines || startLine < 1 || endLine < startLine) {
          context.set(this.excerptKey(excerpt), { before: [], after: [] });
          continue;
        }

        const beforeStart = Math.max(1, startLine - 3);
        const before = lines
          .slice(beforeStart - 1, startLine - 1)
          .map((content, index) => ({
            lineNumber: beforeStart + index,
            content,
          }));
        const after = lines
          .slice(endLine, endLine + 3)
          .map((content, index) => ({
            lineNumber: endLine + index + 1,
            content,
          }));
        context.set(this.excerptKey(excerpt), { before, after });
      }
      return context;
    } catch {
      throw new AppException(
        ErrorCode.STORAGE_UNAVAILABLE,
        'No se pudo reconstruir el contexto de la versión del proyecto.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      await workspace?.cleanup();
    }
  }

  private throwSnapshotUnavailable(): never {
    throw new AppException(
      ErrorCode.STORAGE_UNAVAILABLE,
      'No se pudo reconstruir el contexto de la versión del proyecto.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private mapExcerpt(
    value: unknown,
    lineContext: Map<
      string,
      { before: SourceLineResponse[]; after: SourceLineResponse[] }
    >,
  ): SourceExcerptResponse {
    const excerpt = safeStoredExcerpt(value);
    const context = lineContext.get(this.excerptKey(excerpt)) ?? {
      before: [],
      after: [],
    };
    return { ...excerpt, before: context.before, after: context.after };
  }

  private mapTarget(
    target: Record<string, unknown>,
    lineContext: Map<
      string,
      { before: SourceLineResponse[]; after: SourceLineResponse[] }
    >,
  ): RagTargetNodeResponse {
    if (
      !Array.isArray(target.chunkIds) ||
      target.chunkIds.some((id) => typeof id !== 'string')
    ) {
      throw invalidStoredDetail();
    }
    return {
      chunkIds: target.chunkIds as string[],
      excerpt: this.mapExcerpt(target.excerpt, lineContext),
      tokenCount: this.requireNonNegativeInteger(target.tokenCount),
    };
  }

  private mapCandidate(
    candidate: unknown,
    lineContext: Map<
      string,
      { before: SourceLineResponse[]; after: SourceLineResponse[] }
    >,
  ): RagCandidateNodeResponse {
    const value = isRecord(candidate) ? candidate : {};
    if (value.decision !== 'SELECTED' && value.decision !== 'DISCARDED') {
      throw invalidStoredDetail();
    }
    const decision = value.decision;
    let discardReason: RagDiscardReason | null = null;
    if (decision === 'SELECTED') {
      if (value.discardReason !== null) throw invalidStoredDetail();
    } else {
      if (!isRagDiscardReason(value.discardReason)) throw invalidStoredDetail();
      discardReason = value.discardReason;
    }
    if (
      typeof value.chunkId !== 'string' ||
      !Number.isSafeInteger(value.rank) ||
      (value.rank as number) < 1 ||
      !Number.isSafeInteger(value.tokenCount) ||
      (value.tokenCount as number) < 0 ||
      typeof value.combinedScore !== 'number' ||
      !Number.isFinite(value.combinedScore) ||
      (value.semanticScore !== null &&
        (typeof value.semanticScore !== 'number' ||
          !Number.isFinite(value.semanticScore))) ||
      (value.structuralMatch !== null &&
        value.structuralMatch !== 'IMPORTS' &&
        value.structuralMatch !== 'IMPORTED_BY') ||
      !Array.isArray(value.matchedVia) ||
      value.matchedVia.some(
        (item) =>
          item !== 'SEMANTIC' && item !== 'IMPORTS' && item !== 'IMPORTED_BY',
      )
    ) {
      throw invalidStoredDetail();
    }
    return {
      chunkId: value.chunkId,
      rank: value.rank as number,
      excerpt: this.mapExcerpt(value.excerpt, lineContext),
      tokenCount: value.tokenCount as number,
      semanticScore: value.semanticScore as number | null,
      structuralMatch: value.structuralMatch as
        'IMPORTS' | 'IMPORTED_BY' | null,
      combinedScore: value.combinedScore,
      matchedVia: value.matchedVia as (
        'SEMANTIC' | 'IMPORTS' | 'IMPORTED_BY'
      )[],
      decision,
      discardReason,
    };
  }

  private mapObservation(
    rawObservation: unknown,
    lineContext: Map<
      string,
      { before: SourceLineResponse[]; after: SourceLineResponse[] }
    >,
  ): AgentObservationResponse {
    const observation = isRecord(rawObservation) ? rawObservation : {};
    if (
      observation.kind !== 'FILE_LIST_SUMMARY' &&
      observation.kind !== 'TEXT_MATCH' &&
      observation.kind !== 'SYMBOL' &&
      observation.kind !== 'FILE_CONTENT'
    ) {
      throw invalidStoredDetail();
    }
    return {
      kind: observation.kind,
      filePath:
        typeof observation.filePath === 'string' &&
        isSafeRelativePath(observation.filePath)
          ? observation.filePath
          : null,
      symbolName:
        typeof observation.symbolName === 'string'
          ? observation.symbolName
          : null,
      excerpt: observation.excerpt
        ? this.mapExcerpt(observation.excerpt, lineContext)
        : null,
      discoveredFilesCount: this.nullableNumber(
        observation.discoveredFilesCount,
      ),
    };
  }

  private mapConfiguration(
    value: unknown,
  ): RagContextTraceDetailResponse['configuration'] {
    const config = this.requireRecord(value);
    return {
      minimumScore: this.requireFiniteNumber(config.minimumScore),
      topK: this.requireNonNegativeInteger(config.topK),
      maxContextTokens: this.requireNonNegativeInteger(config.maxContextTokens),
      semanticWeight: this.requireFiniteNumber(config.semanticWeight),
      structuralWeight: this.requireFiniteNumber(config.structuralWeight),
    };
  }

  private toolName(
    value: unknown,
  ): AgentContextTraceDetailResponse['trajectory'][number]['toolName'] {
    if (
      value === 'list_files' ||
      value === 'search_text' ||
      value === 'inspect_symbol' ||
      value === 'read_file'
    )
      return value;
    throw invalidStoredDetail();
  }

  private stepStatus(
    value: unknown,
  ): AgentContextTraceDetailResponse['trajectory'][number]['status'] {
    if (value === 'SUCCEEDED' || value === 'EMPTY' || value === 'FAILED')
      return value;
    throw invalidStoredDetail();
  }

  private requireRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw invalidStoredDetail();
    return value;
  }

  private requireString(value: unknown): string {
    if (typeof value !== 'string') throw invalidStoredDetail();
    return value;
  }

  private requireBoolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw invalidStoredDetail();
    return value;
  }

  private requireSha256(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
      throw invalidStoredDetail();
    }
    return value.toLowerCase();
  }

  private requireFiniteNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw invalidStoredDetail();
    return value;
  }

  private requireNonNegativeInteger(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
      throw invalidStoredDetail();
    return value as number;
  }

  private requirePositiveInteger(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
      throw invalidStoredDetail();
    return value as number;
  }

  private nullableNumber(value: unknown): number | null {
    if (value === null) return null;
    return this.requireNonNegativeInteger(value);
  }

  private excerptKey(excerpt: StoredExcerpt): string {
    return `${excerpt.filePath}:${excerpt.startLine ?? ''}:${excerpt.endLine ?? ''}:${excerpt.contentSha256}`;
  }
}
