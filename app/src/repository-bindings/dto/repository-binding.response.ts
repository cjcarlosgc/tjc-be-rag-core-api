import type { RepositoryBinding } from '../../generated/prisma/client.js';

export interface ProjectRepositoryBindingResponse {
  projectId: string;
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  integrationBranch: string;
  status: 'ENABLED' | 'DISABLED' | 'REVOKED';
  createdAt: string;
  updatedAt: string;
}

export function toProjectRepositoryBindingResponse(
  binding: RepositoryBinding,
): ProjectRepositoryBindingResponse {
  return {
    projectId: binding.projectId,
    installationId: binding.installationId,
    repositoryId: binding.repositoryId,
    repositoryName: binding.repositoryName,
    integrationBranch: binding.integrationBranch,
    status: binding.status,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
  };
}
