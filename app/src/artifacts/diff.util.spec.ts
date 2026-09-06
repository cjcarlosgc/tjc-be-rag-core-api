import { describe, expect, it } from 'vitest';
import { computeLineDiff } from './diff.util.js';

describe('computeLineDiff', () => {
  it('marks unchanged lines as CONTEXT with matching line numbers', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nb\nc');

    expect(diff).toEqual([
      { type: 'CONTEXT', oldLineNumber: 1, newLineNumber: 1, content: 'a' },
      { type: 'CONTEXT', oldLineNumber: 2, newLineNumber: 2, content: 'b' },
      { type: 'CONTEXT', oldLineNumber: 3, newLineNumber: 3, content: 'c' },
    ]);
  });

  it('detects an appended line as ADDED', () => {
    const diff = computeLineDiff('a\nb', 'a\nb\nc');

    expect(diff).toEqual([
      { type: 'CONTEXT', oldLineNumber: 1, newLineNumber: 1, content: 'a' },
      { type: 'CONTEXT', oldLineNumber: 2, newLineNumber: 2, content: 'b' },
      { type: 'ADDED', oldLineNumber: null, newLineNumber: 3, content: 'c' },
    ]);
  });

  it('detects a removed line as REMOVED', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nc');

    expect(diff).toEqual([
      { type: 'CONTEXT', oldLineNumber: 1, newLineNumber: 1, content: 'a' },
      { type: 'REMOVED', oldLineNumber: 2, newLineNumber: null, content: 'b' },
      { type: 'CONTEXT', oldLineNumber: 3, newLineNumber: 2, content: 'c' },
    ]);
  });

  it('handles a full replacement', () => {
    const diff = computeLineDiff('a', 'b');

    expect(diff).toEqual([
      { type: 'REMOVED', oldLineNumber: 1, newLineNumber: null, content: 'a' },
      { type: 'ADDED', oldLineNumber: null, newLineNumber: 1, content: 'b' },
    ]);
  });
});
