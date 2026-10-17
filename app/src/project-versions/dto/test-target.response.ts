import type { ProjectLanguage, TestFramework } from '../../generated/prisma/enums.js';

export interface TestTargetResponse {
  id: string;
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: string;
  hasTest: boolean;
  testFilePaths: string[];
}

export interface TestInventoryResponse {
  projectVersionId: string;
  language: ProjectLanguage;
  detectedFramework: TestFramework | null;
  targetsTotal: number;
  targetsWithTest: number;
  targetsMissingTest: number;
  targets: TestTargetResponse[];
}
