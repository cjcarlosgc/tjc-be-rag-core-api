import { Injectable } from '@nestjs/common';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const GITHUB_API_VERSION = '2022-11-28';

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

/**
 * HU39: publica la conclusión objetiva de un AnalysisRun como GitHub Check
 * sobre su `headSha`. Escritura (`checks: write`, mínimo privilegio ya
 * aprobado en `system-contract.md`); siempre se crea `status: 'completed'`
 * -Core solo publica una vez que el Run ya terminó, nunca en progreso-.
 */
@Injectable()
export class GithubChecksService {
  async createCheckRun(repoFullName: string, token: string, input: CreateCheckRunInput): Promise<void> {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/check-runs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        name: input.name,
        head_sha: input.headSha,
        status: 'completed',
        conclusion: input.conclusion,
        ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
        output: { title: input.title, summary: input.summary },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GithubAppUnavailableError(
        `GitHub API ${response.status} creando check-run en "${repoFullName}"@"${input.headSha}": ${body}`,
        response.status,
      );
    }
  }
}
