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
