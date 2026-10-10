import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GithubRepositoryContentService,
  type CompareFile,
} from '../github-app/github-repository-content.service.js';
import type {
  AnalysisSymbolToPersist,
  BehaviorConstructRecord,
} from '../analysis-runs/persistence/analysis-symbols.repository.js';
import {
  diffBehaviorConstructs,
  extractBehaviorConstructs,
  scenarioKeyFor,
  type BehaviorConstruct,
} from './behavior-fingerprint/behavior-fingerprint.js';
import { extractPhpBehaviorConstructs } from './behavior-fingerprint/php-behavior-fingerprint.js';

export interface SymbolBehaviorConstructsRequest {
  /** Workspace del HEAD materializado por el job de snapshot. */
  workspaceDir: string;
  installationId: string;
  repositoryName: string;
  /** Base del Run (`run.baseSha`): origen de las construcciones previas. */
  baseSha: string;
  changesetFiles: readonly CompareFile[];
}

export type BehaviorSymbolCandidate = Pick<
  AnalysisSymbolToPersist,
  'language' | 'kind' | 'changeKind' | 'filePath' | 'qualifiedName'
>;

function qualifiesForBehaviorConstructs(symbol: BehaviorSymbolCandidate): boolean {
  return (
    (symbol.language === 'TYPESCRIPT' || symbol.language === 'PHP') &&
    symbol.changeKind === 'DIRECTLY_CHANGED' &&
    (symbol.kind === 'METHOD' || symbol.kind === 'FUNCTION')
  );
}

/**
 * WI-CORE-018 (DEC-FK-003/DEC-FK-004): calcula, dentro del job de snapshot y con el HEAD en disco,
 * las construcciones de comportamiento nuevas o modificadas de cada símbolo `DIRECTLY_CHANGED`
 * `METHOD`/`FUNCTION` de TypeScript (ts-morph) o PHP (tree-sitter), comparando con el código base del
 * Run. La continuación solo lee el resultado; no hace I/O.
 */
@Injectable()
export class SymbolBehaviorConstructsService {
  constructor(private readonly githubRepositoryContentService: GithubRepositoryContentService) {}

  /**
   * Devuelve un arreglo alineado con `symbols`: las construcciones nuevas o modificadas del símbolo
   * (posiblemente vacío), o `null` si el símbolo no califica. Los errores de GitHub se propagan.
   */
  async compute(
    request: SymbolBehaviorConstructsRequest,
    symbols: readonly BehaviorSymbolCandidate[],
  ): Promise<Array<BehaviorConstructRecord[] | null>> {
    const results: Array<BehaviorConstructRecord[] | null> = symbols.map(() => null);
    const entriesByFile = new Map<string, Array<{ index: number; symbol: BehaviorSymbolCandidate }>>();

    symbols.forEach((symbol, index) => {
      if (!qualifiesForBehaviorConstructs(symbol)) {
        return;
      }
      const entries = entriesByFile.get(symbol.filePath) ?? [];
      entries.push({ index, symbol });
      entriesByFile.set(symbol.filePath, entries);
    });

    const changesetByFile = new Map(request.changesetFiles.map((file) => [file.filename, file]));

    for (const [filePath, entries] of entriesByFile) {
      const headSource = await readFile(join(request.workspaceDir, filePath), 'utf8');
      const baseSource = await this.loadBaseSource(request, filePath, changesetByFile.get(filePath));

      for (const { index, symbol } of entries) {
        results[index] = await this.constructsFor(symbol, headSource, baseSource);
      }
    }

    return results;
  }

  /** Una sola llamada a GitHub por archivo; un archivo `added` no tiene base y no se consulta. */
  private loadBaseSource(
    request: SymbolBehaviorConstructsRequest,
    filePath: string,
    file: CompareFile | undefined,
  ): Promise<string | null> {
    if (file?.status === 'added') {
      return Promise.resolve(null);
    }

    return this.githubRepositoryContentService.getFileContent(
      request.installationId,
      request.repositoryName,
      file?.previousFilename ?? filePath,
      request.baseSha,
    );
  }

  private async constructsFor(
    symbol: BehaviorSymbolCandidate,
    headSource: string,
    baseSource: string | null,
  ): Promise<BehaviorConstructRecord[]> {
    const extract = (source: string): Promise<BehaviorConstruct[]> | BehaviorConstruct[] =>
      symbol.language === 'PHP'
        ? extractPhpBehaviorConstructs(source, symbol.qualifiedName)
        : extractBehaviorConstructs(source, symbol.qualifiedName);
    const head = await extract(headSource);
    const base: BehaviorConstruct[] = baseSource === null ? [] : await extract(baseSource);
    const targetRef = `${symbol.filePath}::${symbol.qualifiedName}`;

    return diffBehaviorConstructs(base, head).map((construct) => ({
      scenarioKind: construct.scenarioKind,
      scenarioKey: scenarioKeyFor(targetRef, construct),
      order: construct.order,
      snippet: construct.snippet,
    }));
  }
}
