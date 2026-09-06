export interface DiffLine {
  type: 'CONTEXT' | 'ADDED' | 'REMOVED';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

/**
 * Diff de líneas basado en LCS (programación dinámica O(n*m)); suficiente
 * para el tamaño típico de un archivo de test en V1.
 */
export function computeLineDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => Array.from<number>({ length: n + 1 }).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNumber = 1;
  let newLineNumber = 1;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'CONTEXT', oldLineNumber, newLineNumber, content: oldLines[i] });
      i += 1;
      j += 1;
      oldLineNumber += 1;
      newLineNumber += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'REMOVED', oldLineNumber, newLineNumber: null, content: oldLines[i] });
      i += 1;
      oldLineNumber += 1;
    } else {
      result.push({ type: 'ADDED', oldLineNumber: null, newLineNumber, content: newLines[j] });
      j += 1;
      newLineNumber += 1;
    }
  }

  while (i < m) {
    result.push({ type: 'REMOVED', oldLineNumber, newLineNumber: null, content: oldLines[i] });
    i += 1;
    oldLineNumber += 1;
  }

  while (j < n) {
    result.push({ type: 'ADDED', oldLineNumber: null, newLineNumber, content: newLines[j] });
    j += 1;
    newLineNumber += 1;
  }

  return result;
}
