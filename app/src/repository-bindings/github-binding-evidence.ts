import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface GithubBindingEvidenceClaims {
  v: 1;
  aud: 'github-binding';
  act: 'CREATE_REPOSITORY_BINDING';
  sub: string;
  githubUserId: string;
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  ownerId: string;
  installationId: string;
  integrationBranch: string;
  iat: number;
  exp: number;
  jti: string;
}

const MAX_TTL_SECONDS = 60;

export function issueGithubBindingEvidence(
  secret: string,
  input: Omit<GithubBindingEvidenceClaims, 'v' | 'aud' | 'act' | 'iat' | 'exp' | 'jti'>,
  nowMs = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const claims: GithubBindingEvidenceClaims = {
    v: 1,
    aud: 'github-binding',
    act: 'CREATE_REPOSITORY_BINDING',
    ...input,
    iat,
    exp: iat + MAX_TTL_SECONDS,
    jti: randomUUID(),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(secret, payload).toString('base64url')}`;
}

export function verifyGithubBindingEvidence(
  secret: string,
  token: string,
  nowMs = Date.now(),
): GithubBindingEvidenceClaims | null {
  if (token.length > 8192) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  let supplied: Buffer;
  let raw: unknown;
  try {
    supplied = Buffer.from(signature, 'base64url');
    const expected = sign(secret, payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }

  if (!isClaims(raw)) return null;
  const now = Math.floor(nowMs / 1000);
  if (raw.iat > now + 5 || raw.exp <= now || raw.exp <= raw.iat || raw.exp - raw.iat > MAX_TTL_SECONDS) return null;
  return raw;
}

function sign(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

function isClaims(value: unknown): value is GithubBindingEvidenceClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return claim.v === 1 && claim.aud === 'github-binding' && claim.act === 'CREATE_REPOSITORY_BINDING' &&
    ['sub', 'githubUserId', 'projectId', 'repositoryId', 'repositoryName', 'ownerId', 'installationId', 'integrationBranch', 'jti']
      .every((key) => typeof claim[key] === 'string' && (claim[key] as string).length > 0) &&
    Number.isSafeInteger(claim.iat) && Number.isSafeInteger(claim.exp);
}
