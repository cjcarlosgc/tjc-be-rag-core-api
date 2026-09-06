import type { ProjectVersion } from '../../generated/prisma/client.js';

export interface ProjectVersionResponse {
  id: string;
  projectId: string;
  status: string;
  originalFileName: string | null;
  sizeBytes: number | null;
  filesProcessed: number | null;
  chunksCount: number | null;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toProjectVersionResponse(version: ProjectVersion): ProjectVersionResponse {
  return {
    id: version.id,
    projectId: version.projectId,
    status: version.status,
    originalFileName: version.originalFileName,
    sizeBytes: version.sizeBytes,
    filesProcessed: version.filesProcessed,
    chunksCount: version.chunksCount,
    failureReason: version.failureReason,
    startedAt: version.startedAt?.toISOString() ?? null,
    completedAt: version.completedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}
