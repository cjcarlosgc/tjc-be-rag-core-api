export interface GitHubUserRepositoryResponse {
  repositoryId: string;
  name: string;
  repositoryName: string;
  owner: { login: string; type: 'User' | 'Organization'; avatarUrl: string | null };
  private: boolean;
  defaultBranch: string;
  permissions: { admin: boolean; maintain: boolean; push: boolean; pull: boolean };
}
