import type { AnalysisSymbol, TestTarget } from '../generated/prisma/client.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';

/**
 * `AnalysisSymbol.qualifiedName` se construye como `parentSymbolName.symbolName`
 * para métodos (`snapshot-analysis-job.handler.ts#qualifiedNameOf`) o como el
 * nombre crudo para funciones sueltas. Se revierte aquí para armar el mismo
 * `RetrievalTarget` que ya consume `RetrievalService`/`ContextBuilder`.
 */
export function toRetrievalTarget(symbol: Pick<AnalysisSymbol, 'kind' | 'qualifiedName' | 'filePath'>): RetrievalTarget {
  if (symbol.kind === 'METHOD') {
    const dotIndex = symbol.qualifiedName.indexOf('.');
    const className = dotIndex >= 0 ? symbol.qualifiedName.slice(0, dotIndex) : symbol.qualifiedName;
    const methodName = dotIndex >= 0 ? symbol.qualifiedName.slice(dotIndex + 1) : symbol.qualifiedName;

    return {
      filePath: symbol.filePath,
      symbolName: className,
      methodName,
      targetType: 'METHOD',
    };
  }

  return {
    filePath: symbol.filePath,
    symbolName: symbol.qualifiedName,
    methodName: null,
    targetType: 'FUNCTION',
  };
}

/** Empareja un símbolo con el `TestTarget` (HU33, misma versión) que describe el mismo elemento. */
export function findMatchingTestTarget(
  targets: TestTarget[],
  symbol: Pick<AnalysisSymbol, 'kind' | 'qualifiedName' | 'filePath'>,
): TestTarget | undefined {
  const retrievalTarget = toRetrievalTarget(symbol);
  const targetType = retrievalTarget.targetType;

  return targets.find(
    (target) =>
      target.filePath === retrievalTarget.filePath &&
      target.targetType === targetType &&
      target.symbolName === retrievalTarget.symbolName &&
      target.methodName === retrievalTarget.methodName,
  );
}
