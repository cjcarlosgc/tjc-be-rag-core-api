import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { Project } from 'ts-morph';

export interface ParsedChunk {
  filePath: string;
  symbolKind: 'CLASS' | 'FUNCTION' | 'INTERFACE' | 'TYPE_ALIAS' | 'ENUM' | 'FILE';
  symbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

@Injectable()
export class TypeScriptParserService {
  parse(rootDir: string, relativeSourceFiles: string[]): ParsedChunk[] {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });

    const chunks: ParsedChunk[] = [];

    for (const relativePath of relativeSourceFiles) {
      const sourceFile = project.addSourceFileAtPath(join(rootDir, relativePath));
      const fileChunks: ParsedChunk[] = [
        ...sourceFile
          .getClasses()
          .map((node) =>
            this.toChunk(relativePath, 'CLASS', node.getName() ?? null, node),
          ),
        ...sourceFile
          .getFunctions()
          .map((node) => this.toChunk(relativePath, 'FUNCTION', node.getName() ?? null, node)),
        ...sourceFile
          .getInterfaces()
          .map((node) => this.toChunk(relativePath, 'INTERFACE', node.getName(), node)),
        ...sourceFile
          .getTypeAliases()
          .map((node) => this.toChunk(relativePath, 'TYPE_ALIAS', node.getName(), node)),
        ...sourceFile
          .getEnums()
          .map((node) => this.toChunk(relativePath, 'ENUM', node.getName(), node)),
      ];

      if (fileChunks.length === 0) {
        const content = sourceFile.getFullText().trim();

        if (content.length > 0) {
          fileChunks.push({
            filePath: relativePath,
            symbolKind: 'FILE',
            symbolName: null,
            startLine: 1,
            endLine: sourceFile.getEndLineNumber(),
            content,
          });
        }
      }

      chunks.push(...fileChunks);
      project.removeSourceFile(sourceFile);
    }

    return chunks;
  }

  private toChunk(
    filePath: string,
    symbolKind: ParsedChunk['symbolKind'],
    symbolName: string | null,
    node: { getStartLineNumber(): number; getEndLineNumber(): number; getFullText(): string },
  ): ParsedChunk {
    return {
      filePath,
      symbolKind,
      symbolName,
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      content: node.getFullText().trim(),
    };
  }
}
