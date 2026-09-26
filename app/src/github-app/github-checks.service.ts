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

/** Core decide el contenido y GitHub Integration efectúa la escritura del Check. */
@Injectable()
export class GithubChecksService {
  constructor(private readonly integration: GithubIntegrationClient) {}

  async createCheckRun(
    installationId: string,
    repositoryName: string,
    input: CreateCheckRunInput,
  ): Promise<void> {
    await this.integration.post<void>('/checks', {
      installationId,
      repositoryName,
      name: input.name,
      headSha: input.headSha,
      conclusion: input.conclusion,
      title: input.title,
      summary: input.summary,
      ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
    });
  }
}
