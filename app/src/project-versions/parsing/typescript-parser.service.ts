import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';
import { Node, Project, type SourceFile } from 'ts-morph';

export type ChunkSymbolKind =
  | 'CLASS'
  | 'METHOD'
  | 'CONSTRUCTOR'
  | 'FUNCTION'
  | 'INTERFACE'
  | 'TYPE_ALIAS'
  | 'ENUM'
  | 'FILE';

export interface ParsedChunk {
  filePath: string;
  symbolKind: ChunkSymbolKind;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
  importsUsed: string[];
  tokenCount: number;
  partIndex: number;
  partsTotal: number;
}

const DEFAULT_MAX_CHUNK_TOKENS = 1500;

interface DeclaredImport {
  moduleSpecifier: string;
  localNames: string[];
}

@Injectable()
export class TypeScriptParserService {
  constructor(private readonly configService: ConfigService) {}

  parse(rootDir: string, relativeSourceFiles: string[]): ParsedChunk[] {
    const maxChunkTokens = this.configService.get<number>(
      'INDEXING_MAX_CHUNK_TOKENS',
      DEFAULT_MAX_CHUNK_TOKENS,
    );
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });

    const chunks: ParsedChunk[] = [];

    for (const relativePath of relativeSourceFiles) {
      const sourceFile = project.addSourceFileAtPath(join(rootDir, relativePath));
      const sourceText = sourceFile.getFullText();
      const declaredImports = this.collectDeclaredImports(sourceFile);
      const fileChunks: ParsedChunk[] = [];

      for (const node of sourceFile.getClasses()) {
        const className = node.getName() ?? null;

        fileChunks.push(
          ...this.buildChunks(
            relativePath,
            'CLASS',
            className,
            null,
            node,
            sourceText,
            declaredImports,
            maxChunkTokens,
          ),
        );

        for (const method of node.getMethods()) {
          fileChunks.push(
            ...this.buildChunks(
              relativePath,
              'METHOD',
              method.getName(),
              className,
              method,
              sourceText,
              declaredImports,
              maxChunkTokens,
            ),
          );
        }

        for (const ctor of node.getConstructors()) {
          fileChunks.push(
            ...this.buildChunks(
              relativePath,
              'CONSTRUCTOR',
              'constructor',
              className,
              ctor,
              sourceText,
              declaredImports,
              maxChunkTokens,
            ),
          );
        }
      }

      for (const node of sourceFile.getFunctions()) {
        fileChunks.push(
          ...this.buildChunks(
            relativePath,
            'FUNCTION',
            node.getName() ?? null,
            null,
            node,
            sourceText,
            declaredImports,
            maxChunkTokens,
          ),
        );
      }

      for (const node of sourceFile.getInterfaces()) {
        fileChunks.push(
          ...this.buildChunks(
            relativePath,
            'INTERFACE',
            node.getName(),
            null,
            node,
            sourceText,
            declaredImports,
            maxChunkTokens,
          ),
        );
      }

      for (const node of sourceFile.getTypeAliases()) {
        fileChunks.push(
          ...this.buildChunks(
            relativePath,
            'TYPE_ALIAS',
            node.getName(),
            null,
            node,
            sourceText,
            declaredImports,
            maxChunkTokens,
          ),
        );
      }

      for (const node of sourceFile.getEnums()) {
        fileChunks.push(
          ...this.buildChunks(
            relativePath,
            'ENUM',
            node.getName(),
            null,
            node,
            sourceText,
            declaredImports,
            maxChunkTokens,
          ),
        );
      }

      if (fileChunks.length === 0 && sourceText.trim().length > 0) {
        const parts = this.splitContent(
          sourceText,
          0,
          sourceText.length,
          sourceFile.getStatements(),
          maxChunkTokens,
        );

        fileChunks.push(
          ...this.toChunks(
            relativePath,
            'FILE',
            null,
            null,
            parts,
            1,
            sourceFile.getEndLineNumber(),
            declaredImports,
          ),
        );
      }

      chunks.push(...fileChunks);
      project.removeSourceFile(sourceFile);
    }

    return chunks;
  }

  private buildChunks(
    filePath: string,
    symbolKind: ChunkSymbolKind,
    symbolName: string | null,
    parentSymbolName: string | null,
    node: Node,
    sourceText: string,
    declaredImports: DeclaredImport[],
    maxChunkTokens: number,
  ): ParsedChunk[] {
    const parts = this.splitContent(
      sourceText,
      node.getFullStart(),
      node.getEnd(),
      this.getStructuralBlocks(node),
      maxChunkTokens,
    );

    return this.toChunks(
      filePath,
      symbolKind,
      symbolName,
      parentSymbolName,
      parts,
      node.getStartLineNumber(),
      node.getEndLineNumber(),
      declaredImports,
    );
  }

  private toChunks(
    filePath: string,
    symbolKind: ChunkSymbolKind,
    symbolName: string | null,
    parentSymbolName: string | null,
    parts: string[],
    startLine: number,
    endLine: number,
    declaredImports: DeclaredImport[],
  ): ParsedChunk[] {
    const partsTotal = parts.length;

    return parts.map((content, index) => ({
      filePath,
      symbolKind,
      symbolName,
      parentSymbolName,
      startLine,
      endLine,
      content,
      importsUsed: this.extractImportsUsed(declaredImports, content),
      tokenCount: countTokens(content),
      partIndex: index + 1,
      partsTotal,
    }));
  }

  /**
   * Divide el rango [start,end) del texto fuente en partes ordenadas cuando
   * excede maxChunkTokens, sin solapamiento textual, cortando entre
   * miembros/statements de alto nivel cuando `blocks` los provee (clase,
   * interfaz, enum, función/método/constructor, o el archivo completo). Un
   * único bloque que por sí solo exceda el límite queda como una parte propia.
   */
  private splitContent(
    sourceText: string,
    start: number,
    end: number,
    blocks: Node[] | null,
    maxChunkTokens: number,
  ): string[] {
    const trimmed = sourceText.slice(start, end).trim();

    if (trimmed.length === 0) {
      return [];
    }

    if (countTokens(trimmed) <= maxChunkTokens || !blocks || blocks.length === 0) {
      return [trimmed];
    }

    return this.groupBlocksIntoParts(sourceText, start, end, blocks, maxChunkTokens);
  }

  private groupBlocksIntoParts(
    sourceText: string,
    start: number,
    end: number,
    blocks: Node[],
    maxChunkTokens: number,
  ): string[] {
    const header = sourceText.slice(start, blocks[0].getFullStart());
    const footer = sourceText.slice(blocks[blocks.length - 1].getEnd(), end);
    const blockTexts = blocks.map((block, index) => {
      const blockStart = block.getFullStart();
      const blockEnd =
        index === blocks.length - 1 ? block.getEnd() : blocks[index + 1].getFullStart();
      return sourceText.slice(blockStart, blockEnd);
    });

    const parts: string[] = [];
    let current = header;
    let currentTokens = countTokens(header);

    for (const blockText of blockTexts) {
      const blockTokens = countTokens(blockText);

      if (current !== header && currentTokens + blockTokens > maxChunkTokens) {
        parts.push(current);
        current = blockText;
        currentTokens = blockTokens;
      } else {
        current += blockText;
        currentTokens += blockTokens;
      }
    }

    current += footer;
    parts.push(current);

    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  }

  private getStructuralBlocks(node: Node): Node[] | null {
    if (Node.isClassDeclaration(node) || Node.isInterfaceDeclaration(node)) {
      const members = node.getMembers();
      return members.length > 0 ? members : null;
    }

    if (Node.isEnumDeclaration(node)) {
      const members = node.getMembers();
      return members.length > 0 ? members : null;
    }

    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node)
    ) {
      const body = node.getBody();
      if (body && Node.isBlock(body)) {
        const statements = body.getStatements();
        return statements.length > 0 ? statements : null;
      }
      return null;
    }

    return null;
  }

  private collectDeclaredImports(sourceFile: SourceFile): DeclaredImport[] {
    return sourceFile.getImportDeclarations().map((importDeclaration) => {
      const localNames: string[] = [];
      const defaultImport = importDeclaration.getDefaultImport();

      if (defaultImport) {
        localNames.push(defaultImport.getText());
      }

      const namespaceImport = importDeclaration.getNamespaceImport();

      if (namespaceImport) {
        localNames.push(namespaceImport.getText());
      }

      for (const named of importDeclaration.getNamedImports()) {
        localNames.push((named.getAliasNode() ?? named.getNameNode()).getText());
      }

      return {
        moduleSpecifier: importDeclaration.getModuleSpecifierValue(),
        localNames,
      };
    });
  }

  private extractImportsUsed(declaredImports: DeclaredImport[], content: string): string[] {
    const modules = new Set<string>();

    for (const { moduleSpecifier, localNames } of declaredImports) {
      const isReferenced = localNames.some((name) =>
        new RegExp(`\\b${this.escapeForRegExp(name)}\\b`).test(content),
      );

      if (isReferenced) {
        modules.add(moduleSpecifier);
      }
    }

    return [...modules].sort();
  }

  private escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
