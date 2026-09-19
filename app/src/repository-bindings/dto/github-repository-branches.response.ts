export interface GitHubRepositoryBranchResponse {
  name: string;
  protected: boolean;
}

export interface GitHubRepositoryBranchesResponse {
  items: GitHubRepositoryBranchResponse[];
}
