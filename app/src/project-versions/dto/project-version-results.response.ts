import type { ProjectLanguage, TestFramework } from '../../generated/prisma/enums.js';

export interface ProjectVersionResultsResponse {
  id: string;
  projectId: string;
  status: string;
  language: ProjectLanguage;
  filesProcessed: number;
  chunksCount: number;
  detectedFramework: TestFramework | null;
  targetsTotal: number;
  targetsWithTest: number;
  targetsMissingTest: number;
  completedAt: string | null;
}
