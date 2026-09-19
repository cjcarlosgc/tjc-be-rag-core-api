import { Injectable } from '@nestjs/common';
import { GithubAppUnavailableError } from './github-app-auth.service.js';

const GITHUB_API_VERSION = '2022-11-28';

export interface TreeEntryInput {
  path: string;
  content: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
  state: 'open' | 'closed';
}

/**
 * HU40: escritura vía Git Data API + Pulls API para publicar el companion
 * PR. `contents y pull requests: write` (mínimo privilegio, aprobado en
 * `system-contract.md`, "solo al habilitar publicación"). `repoFullName` es
 * `owner/repo`.
 */
@Injectable()
export class GithubGitDataService {
  /** `null` si la rama todavía no existe (companion PR nuevo, no un reintento). */
  async getBranchHeadSha(repoFullName: string, branchName: string, token: string): Promise<string | null> {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/ref/heads/${branchName}`,
      { headers: this.headers(token) },
    );

    if (response.status === 404) {
      return null;
    }

    const data = (await this.parse<{ object: { sha: string } }>(response, repoFullName)) ;
    return data.object.sha;
  }

  async createBranch(repoFullName: string, branchName: string, fromSha: string, token: string): Promise<void> {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/git/refs`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
    });

    await this.parse(response, repoFullName);
  }

  async getCommitTreeSha(repoFullName: string, commitSha: string, token: string): Promise<string> {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits/${commitSha}`, {
      headers: this.headers(token),
    });
    const data = await this.parse<{ tree: { sha: string } }>(response, repoFullName);
    return data.tree.sha;
  }

  async createBlob(repoFullName: string, content: string, token: string): Promise<string> {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/git/blobs`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    const data = await this.parse<{ sha: string }>(response, repoFullName);
    return data.sha;
  }

  async createTree(
    repoFullName: string,
    baseTreeSha: string,
    entries: TreeEntryInput[],
    token: string,
  ): Promise<string> {
    const blobShas = await Promise.all(
      entries.map((entry) => this.createBlob(repoFullName, entry.content, token)),
    );
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: entries.map((entry, index) => ({
          path: entry.path,
          mode: '100644',
          type: 'blob',
          sha: blobShas[index],
        })),
      }),
    });
    const data = await this.parse<{ sha: string }>(response, repoFullName);
    return data.sha;
  }

  async createCommit(
    repoFullName: string,
    message: string,
    treeSha: string,
    parentSha: string,
    token: string,
  ): Promise<string> {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
    });
    const data = await this.parse<{ sha: string }>(response, repoFullName);
    return data.sha;
  }

  async updateRef(repoFullName: string, branchName: string, commitSha: string, token: string): Promise<void> {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/refs/heads/${branchName}`,
      {
        method: 'PATCH',
        headers: this.headers(token),
        body: JSON.stringify({ sha: commitSha, force: false }),
      },
    );
    await this.parse(response, repoFullName);
  }

  /** Busca un PR (abierto o cerrado) con ese head branch, sin importar el estado. */
  async findPullRequestByHead(
    repoFullName: string,
    branchName: string,
    token: string,
  ): Promise<PullRequestRef | null> {
    const owner = repoFullName.split('/')[0];
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/pulls?head=${owner}:${branchName}&state=all`,
      { headers: this.headers(token) },
    );
    const data = await this.parse<Array<{ number: number; html_url: string; state: 'open' | 'closed' }>>(
      response,
      repoFullName,
    );

    if (data.length === 0) {
      return null;
    }

    return { number: data[0].number, url: data[0].html_url, state: data[0].state };
  }

  async createPullRequest(
    repoFullName: string,
    input: { title: string; head: string; base: string; body: string },
    token: string,
  ): Promise<PullRequestRef> {
    const response = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ title: input.title, head: input.head, base: input.base, body: input.body }),
    });
    const data = await this.parse<{ number: number; html_url: string }>(response, repoFullName);
    return { number: data.number, url: data.html_url, state: 'open' };
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
  }

  private async parse<T>(response: Response, repoFullName: string): Promise<T> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GithubAppUnavailableError(
        `GitHub API ${response.status} en "${repoFullName}": ${body}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}
