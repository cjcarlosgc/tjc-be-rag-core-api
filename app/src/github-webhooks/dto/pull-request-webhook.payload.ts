export type PullRequestWebhookAction =
  | 'opened'
  | 'reopened'
  | 'ready_for_review'
  | 'synchronize'
  | 'closed'
  | 'edited'
  | 'converted_to_draft';

/** Subconjunto tipado del payload real de GitHub para `pull_request`; solo los campos que Core lee. */
export interface GithubPullRequestWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    title: string;
    draft: boolean;
    merged: boolean;
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
    user: { login: string } | null;
  };
  repository: {
    id: number;
    full_name: string;
  };
  installation?: { id: number };
}
