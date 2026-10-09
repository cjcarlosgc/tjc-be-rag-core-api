import { Injectable } from '@nestjs/common';
import { GithubIntegrationClient } from './github-integration.client.js';

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'action_required';

export interface CreateCheckRunInput {
  name: string;
  headSha: string;
  conclusion: CheckConclusion;
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface CreateCheckRunResult {
  /** Id del Check devuelto por GitHub Integration; null con 204 sin cuerpo o con una forma sin id. */
  checkId: string | null;
}

/**
 * Core decide el contenido y GitHub Integration efectúa la escritura del Check. GH-INTEROP 1.3 responde
 * `200 { checkId }`; un `204` sin cuerpo (transición) se trata como `checkId = null`.
 */
@Injectable()
export class GithubChecksService {
  constructor(private readonly integration: GithubIntegrationClient) {}

  async createCheckRun(
    installationId: string,
    repositoryName: string,
    input: CreateCheckRunInput,
  ): Promise<CreateCheckRunResult> {
    const response = await this.integration.post<unknown>('/checks', {
      installationId,
      repositoryName,
      name: input.name,
      headSha: input.headSha,
      conclusion: input.conclusion,
      title: input.title,
      summary: input.summary,
      ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
    });

    return { checkId: readCheckId(response) };
  }
}

/** Tolera cualquier forma: solo un `checkId` de texto no vacío cuenta; el resto es null sin lanzar. */
function readCheckId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;

  const checkId = (body as { checkId?: unknown }).checkId;
  return typeof checkId === 'string' && checkId.length > 0 ? checkId : null;
}
