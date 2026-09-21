import type { WorkspaceRefResponse } from '../../workspaces/dto/workspace.response.js';

/** `INTEROP-2.4` §6.13: rol del usuario autenticado en el Project. */
export type ProjectRole = 'ADMIN' | 'MAINTAINER' | 'READER';

export interface ProjectResponse {
  id: string;
  name: string;
  currentVersionId: string | null;
  workspace: WorkspaceRefResponse;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
}
