import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { Project, Scope } from 'ts-morph';
import { TestTargetType } from '../../generated/prisma/enums.js';

export interface TestTargetCandidate {
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: TestTargetType;
  startLine: number;
  endLine: number;
}

@Injectable()
export class TestTargetExtractorService {
  extract(rootDir: string, relativeProductionFiles: string[]): TestTargetCandidate[] {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });

    const candidates: TestTargetCandidate[] = [];

    for (const relativePath of relativeProductionFiles) {
      const sourceFile = project.addSourceFileAtPath(join(rootDir, relativePath));

      for (const classDeclaration of sourceFile.getClasses()) {
        const className = classDeclaration.getName();

        if (!classDeclaration.isExported() || !className) {
          continue;
        }

        candidates.push({
          filePath: relativePath,
          symbolName: className,
          methodName: null,
          targetType: TestTargetType.CLASS,
          startLine: classDeclaration.getStartLineNumber(),
          endLine: classDeclaration.getEndLineNumber(),
        });

        for (const method of classDeclaration.getMethods()) {
          const scope = method.getScope();

          if (scope === Scope.Private || scope === Scope.Protected) {
            continue;
          }

          candidates.push({
            filePath: relativePath,
            symbolName: className,
            methodName: method.getName(),
            targetType: TestTargetType.METHOD,
            startLine: method.getStartLineNumber(),
            endLine: method.getEndLineNumber(),
          });
        }
      }

      for (const functionDeclaration of sourceFile.getFunctions()) {
        const functionName = functionDeclaration.getName();

        if (!functionDeclaration.isExported() || !functionName) {
          continue;
        }

        candidates.push({
          filePath: relativePath,
          symbolName: functionName,
          methodName: null,
          targetType: TestTargetType.FUNCTION,
          startLine: functionDeclaration.getStartLineNumber(),
          endLine: functionDeclaration.getEndLineNumber(),
        });
      }

      project.removeSourceFile(sourceFile);
    }

    return candidates;
  }
}
