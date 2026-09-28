import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

export interface NormalizedWebhookEvent {
  schemaVersion: 1;
  deliveryId: string;
  eventName: string;
  action: string | null;
  receivedAt: string;
  data: NormalizedWebhookData;
}

export type NormalizedWebhookData =
  | {
      kind: 'PULL_REQUEST';
      repository: { id: string; fullName: string };
      installationId: string | null;
      pullRequestNumber: number;
      pullRequest: {
        title: string;
        draft: boolean;
        merged: boolean;
        createdAt: string | null;
        base: { ref: string; sha: string };
        head: { ref: string; sha: string };
        userLogin: string | null;
      };
    }
  | { kind: 'INSTALLATION'; installationId: string; account: { id: string | null; type: string | null } }
  | {
      kind: 'INSTALLATION_REPOSITORIES';
      installationId: string;
      added: Array<{ id: string; fullName: string }>;
      removed: Array<{ id: string; fullName: string }>;
    }
  | {
      kind: 'REPOSITORY';
      repository: { id: string; fullName: string; owner: { id: string; login: string | null; type: string | null } | null };
      installationId: string | null;
    }
  | { kind: 'MEMBER'; memberId: string | null; repositoryId: string | null }
  | { kind: 'MEMBERSHIP'; memberId: string | null; organizationId: string | null }
  | { kind: 'ORGANIZATION'; organizationId: string | null; organizationLogin: string | null; membershipUserId: string | null }
  | { kind: 'TEAM'; repositoryId: string | null; organizationId: string | null }
  | { kind: 'IGNORED' };

const EVENT_FOR_KIND: Partial<Record<NormalizedWebhookData['kind'], string>> = {
  PULL_REQUEST: 'pull_request',
  INSTALLATION: 'installation',
  INSTALLATION_REPOSITORIES: 'installation_repositories',
  REPOSITORY: 'repository',
  MEMBER: 'member',
  MEMBERSHIP: 'membership',
  ORGANIZATION: 'organization',
  TEAM: 'team',
};

/** Validate and reconstruct the allowlisted GH→Core envelope before any domain effect runs. */
export function parseNormalizedWebhookEvent(value: unknown): NormalizedWebhookEvent {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'deliveryId', 'eventName', 'action', 'receivedAt', 'data'])) {
    return invalid();
  }

  if (
    value.schemaVersion !== 1 ||
    !nonEmptyString(value.deliveryId) ||
    value.deliveryId.length > 255 ||
    !nonEmptyString(value.eventName) ||
    value.eventName.length > 100 ||
    !(value.action === null || typeof value.action === 'string') ||
    (typeof value.action === 'string' && value.action.length > 100) ||
    !isIsoDateTime(value.receivedAt)
  ) {
    return invalid();
  }

  const data = parseData(value.data);
  if (!data) return invalid();

  const expectedEventName = EVENT_FOR_KIND[data.kind];
  if ((expectedEventName && value.eventName !== expectedEventName) || (!expectedEventName && KNOWN_EVENT_NAMES.has(value.eventName))) {
    return invalid();
  }

  return {
    schemaVersion: 1,
    deliveryId: value.deliveryId,
    eventName: value.eventName,
    action: value.action,
    receivedAt: value.receivedAt,
    data,
  };
}

function parseData(value: unknown): NormalizedWebhookData | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;

  switch (value.kind) {
    case 'PULL_REQUEST': {
      if (!hasExactKeys(value, ['kind', 'repository', 'installationId', 'pullRequestNumber', 'pullRequest'])) return null;
      const repository = value.repository;
      const pr = value.pullRequest;
      if (
        !isRecord(repository) || !hasExactKeys(repository, ['id', 'fullName']) || !githubId(repository.id) || !nonEmptyString(repository.fullName) ||
        !(value.installationId === null || githubId(value.installationId)) ||
        !Number.isSafeInteger(value.pullRequestNumber) || (value.pullRequestNumber as number) < 1 ||
        !isRecord(pr) || !hasExactKeys(pr, ['title', 'draft', 'merged', 'createdAt', 'base', 'head', 'userLogin']) ||
        typeof pr.title !== 'string' || typeof pr.draft !== 'boolean' || typeof pr.merged !== 'boolean' ||
        !(pr.createdAt === null || isIsoUtcDateTime(pr.createdAt)) ||
        !(pr.userLogin === null || typeof pr.userLogin === 'string') ||
        !validRefAndSha(pr.base) || !validRefAndSha(pr.head)
      ) return null;
      return {
        kind: 'PULL_REQUEST',
        repository: { id: repository.id, fullName: repository.fullName },
        installationId: value.installationId,
        pullRequestNumber: value.pullRequestNumber as number,
        pullRequest: {
          title: pr.title,
          draft: pr.draft,
          merged: pr.merged,
          createdAt: pr.createdAt,
          base: { ref: (pr.base as Record<string, string>).ref, sha: (pr.base as Record<string, string>).sha },
          head: { ref: (pr.head as Record<string, string>).ref, sha: (pr.head as Record<string, string>).sha },
          userLogin: pr.userLogin,
        },
      };
    }
    case 'INSTALLATION': {
      const account = value.account;
      if (!hasExactKeys(value, ['kind', 'installationId', 'account']) || !githubId(value.installationId) ||
          !isRecord(account) || !hasExactKeys(account, ['id', 'type']) ||
          !(account.id === null || githubId(account.id)) || !(account.type === null || typeof account.type === 'string')) return null;
      return { kind: 'INSTALLATION', installationId: value.installationId, account: { id: account.id, type: account.type } };
    }
    case 'INSTALLATION_REPOSITORIES': {
      if (!hasExactKeys(value, ['kind', 'installationId', 'added', 'removed']) || !githubId(value.installationId)) return null;
      const added = parseRepositoryList(value.added);
      const removed = parseRepositoryList(value.removed);
      return added && removed ? { kind: 'INSTALLATION_REPOSITORIES', installationId: value.installationId, added, removed } : null;
    }
    case 'REPOSITORY': {
      const repository = value.repository;
      if (!hasExactKeys(value, ['kind', 'repository', 'installationId']) ||
          !(value.installationId === null || githubId(value.installationId)) ||
          !isRecord(repository) || !hasExactKeys(repository, ['id', 'fullName', 'owner']) ||
          !githubId(repository.id) || !nonEmptyString(repository.fullName)) return null;
      let owner: { id: string; login: string | null; type: string | null } | null = null;
      if (repository.owner !== null) {
        if (!isRecord(repository.owner) || !hasExactKeys(repository.owner, ['id', 'login', 'type']) || !githubId(repository.owner.id) ||
            !(repository.owner.login === null || typeof repository.owner.login === 'string') ||
            !(repository.owner.type === null || typeof repository.owner.type === 'string')) return null;
        owner = { id: repository.owner.id, login: repository.owner.login, type: repository.owner.type };
      }
      return { kind: 'REPOSITORY', repository: { id: repository.id, fullName: repository.fullName, owner }, installationId: value.installationId };
    }
    case 'MEMBER':
      return hasExactKeys(value, ['kind', 'memberId', 'repositoryId']) && optionalGithubId(value.memberId) && optionalGithubId(value.repositoryId)
        ? { kind: 'MEMBER', memberId: value.memberId, repositoryId: value.repositoryId } : null;
    case 'MEMBERSHIP':
      return hasExactKeys(value, ['kind', 'memberId', 'organizationId']) && optionalGithubId(value.memberId) && optionalGithubId(value.organizationId)
        ? { kind: 'MEMBERSHIP', memberId: value.memberId, organizationId: value.organizationId } : null;
    case 'ORGANIZATION':
      return hasExactKeys(value, ['kind', 'organizationId', 'organizationLogin', 'membershipUserId']) && optionalGithubId(value.organizationId) &&
        (value.organizationLogin === null || typeof value.organizationLogin === 'string') && optionalGithubId(value.membershipUserId)
        ? { kind: 'ORGANIZATION', organizationId: value.organizationId, organizationLogin: value.organizationLogin, membershipUserId: value.membershipUserId } : null;
    case 'TEAM':
      return hasExactKeys(value, ['kind', 'repositoryId', 'organizationId']) && optionalGithubId(value.repositoryId) && optionalGithubId(value.organizationId)
        ? { kind: 'TEAM', repositoryId: value.repositoryId, organizationId: value.organizationId } : null;
    case 'IGNORED':
      return hasExactKeys(value, ['kind']) ? { kind: 'IGNORED' } : null;
    default:
      return null;
  }
}

function parseRepositoryList(value: unknown): Array<{ id: string; fullName: string }> | null {
  if (!Array.isArray(value)) return null;
  const parsed: Array<{ id: string; fullName: string }> = [];
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, ['id', 'fullName']) || !githubId(item.id) || !nonEmptyString(item.fullName)) return null;
    parsed.push({ id: item.id, fullName: item.fullName });
  }
  return parsed;
}

function validRefAndSha(value: unknown): value is { ref: string; sha: string } {
  return isRecord(value) && hasExactKeys(value, ['ref', 'sha']) && typeof value.ref === 'string' && typeof value.sha === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function githubId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}

function optionalGithubId(value: unknown): value is string | null {
  return value === null || githubId(value);
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function isIsoUtcDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

const KNOWN_EVENT_NAMES = new Set(Object.values(EVENT_FOR_KIND));

function invalid(): never {
  throw new AppException(ErrorCode.INVALID_REQUEST, 'El evento normalizado de GitHub es inválido.', HttpStatus.BAD_REQUEST);
}
