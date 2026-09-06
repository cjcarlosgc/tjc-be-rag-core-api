import { Injectable } from '@nestjs/common';
import { join, posix } from 'node:path';
import { Project } from 'ts-morph';
import type { TestTargetCandidate } from './test-target-extractor.service.js';
import { TestTargetType } from '../../generated/prisma/enums.js';

export interface ResolvedTestTarget extends TestTargetCandidate {
  hasTest: boolean;
  testFilePaths: string[];
}

function normalizeModulePath(fromFileRelativePath: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith('.')) {
    return null;
  }

  const fromDir = posix.dirname(fromFileRelativePath);
  const resolved = posix.normalize(posix.join(fromDir, moduleSpecifier));
  return resolved.replace(/\.(ts|tsx|js|jsx)$/, '');
}

function stripExtension(relativePath: string): string {
  return relativePath.replace(/\.(ts|tsx)$/, '');
}

@Injectable()
export class ExistingTestResolverService {
  resolve(
    rootDir: string,
    testFiles: string[],
    candidates: TestTargetCandidate[],
  ): ResolvedTestTarget[] {
    const resolved: ResolvedTestTarget[] = candidates.map((candidate) => ({
      ...candidate,
      hasTest: false,
      testFilePaths: [],
    }));

    if (testFiles.length === 0 || resolved.length === 0) {
      return resolved;
    }

    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });

    for (const testFilePath of testFiles) {
      const sourceFile = project.addSourceFileAtPath(join(rootDir, testFilePath));
      const fileText = sourceFile.getFullText();
      const importedSymbolsByModule = new Map<string, Set<string>>();

      for (const importDeclaration of sourceFile.getImportDeclarations()) {
        const normalized = normalizeModulePath(
          testFilePath,
          importDeclaration.getModuleSpecifierValue(),
        );

        if (!normalized) {
          continue;
        }

        const names = importedSymbolsByModule.get(normalized) ?? new Set<string>();
        const defaultImport = importDeclaration.getDefaultImport();

        if (defaultImport) {
          names.add(defaultImport.getText());
        }

        for (const namedImport of importDeclaration.getNamedImports()) {
          names.add(namedImport.getNameNode().getText());
        }

        importedSymbolsByModule.set(normalized, names);
      }

      for (const target of resolved) {
        const importedNames = importedSymbolsByModule.get(stripExtension(target.filePath));

        if (!importedNames || !importedNames.has(target.symbolName)) {
          continue;
        }

        if (target.targetType === TestTargetType.METHOD) {
          if (!target.methodName || !fileText.includes(`.${target.methodName}(`)) {
            continue;
          }
        }

        target.hasTest = true;

        if (!target.testFilePaths.includes(testFilePath)) {
          target.testFilePaths.push(testFilePath);
        }
      }

      project.removeSourceFile(sourceFile);
    }

    return resolved;
  }
}
