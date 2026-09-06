export type ArtifactType = 'CREATED' | 'MODIFIED';

export interface ArtifactResponse {
  id: string;
  runId: string;
  relativePath: string;
  artifactType: ArtifactType;
  valid: boolean;
  createdAt: string;
}

export interface ArtifactListResponse {
  runId: string;
  items: ArtifactResponse[];
}

export interface DiffLineResponse {
  type: 'CONTEXT' | 'ADDED' | 'REMOVED';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

export interface ArtifactDiffResponse {
  artifactId: string;
  relativePath: string;
  lines: DiffLineResponse[];
}
