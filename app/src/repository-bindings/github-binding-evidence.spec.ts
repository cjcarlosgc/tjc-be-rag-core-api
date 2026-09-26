import { describe, expect, it } from 'vitest';
import { issueGithubBindingEvidence, verifyGithubBindingEvidence } from './github-binding-evidence.js';

const secret = 'test-only-github-binding-evidence-secret';
const input = {
  sub: 'platform-user-1', githubUserId: '123', projectId: 'project-1', repositoryId: '456',
  repositoryName: 'acme/repo', ownerId: '789', installationId: '1011', integrationBranch: 'main',
};

describe('GitHub binding evidence', () => {
  it('signs short-lived scope claims and rejects tampering or another key', () => {
    const token = issueGithubBindingEvidence(secret, input, 1_000_000);
    expect(verifyGithubBindingEvidence(secret, token, 1_001_000)).toMatchObject({
      sub: input.sub, projectId: input.projectId, repositoryId: input.repositoryId,
      repositoryName: input.repositoryName, installationId: input.installationId,
      integrationBranch: input.integrationBranch, exp: 1060,
    });
    expect(verifyGithubBindingEvidence('a-different-secret-with-enough-length', token, 1_001_000)).toBeNull();
    expect(verifyGithubBindingEvidence(secret, `${token}x`, 1_001_000)).toBeNull();
  });

  it('expires after sixty seconds and rejects future-issued claims', () => {
    const token = issueGithubBindingEvidence(secret, input, 1_000_000);
    expect(verifyGithubBindingEvidence(secret, token, 1_060_000)).toBeNull();
    expect(verifyGithubBindingEvidence(secret, token, 990_000)).toBeNull();
  });
});
