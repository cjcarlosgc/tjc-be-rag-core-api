import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { assertPersonalWorkspace } from './personal-workspace.util.js';

describe('assertPersonalWorkspace', () => {
  it('accepts an omitted workspaceId and the own numeric id', () => {
    expect(() => assertPersonalWorkspace(undefined, '1001')).not.toThrow();
    expect(() => assertPersonalWorkspace('1001', '1001')).not.toThrow();
  });

  it.each(['4242', '1002', 'octocat', '01001'])(
    'answers 404 WORKSPACE_NOT_FOUND for %s (organization, foreign account or not a workspace)',
    (workspaceId) => {
      expect(() => assertPersonalWorkspace(workspaceId, '1001')).toThrowError(
        expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_FOUND, status: 404 }),
      );
    },
  );
});
