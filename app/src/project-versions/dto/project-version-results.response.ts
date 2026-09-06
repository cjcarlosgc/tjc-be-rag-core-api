export interface ProjectVersionResultsResponse {
  id: string;
  projectId: string;
  status: string;
  filesProcessed: number;
  chunksCount: number;
  detectedFramework: string | null;
  targetsTotal: number;
  targetsWithTest: number;
  targetsMissingTest: number;
  completedAt: string | null;
}
