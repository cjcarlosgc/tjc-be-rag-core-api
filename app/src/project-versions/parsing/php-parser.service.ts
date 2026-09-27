import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';
import { Language, Parser, type Node as SyntaxNode } from 'web-tree-sitter';
import { TestTargetType } from '../../generated/prisma/enums.js';
import type { ParsedChunk, ChunkSymbolKind } from './typescript-parser.service.js';

export interface PhpTestTargetCandidate {
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: TestTargetType;
  startLine: number;
  endLine: number;
}

export interface PhpAnalysis {
  chunks: ParsedChunk[];
  candidates: PhpTestTargetCandidate[];
}

const DEFAULT_MAX_CHUNK_TOKENS = 1500;
const CLASS_NODES = new Map<string, ChunkSymbolKind>([
  ['class_declaration', 'CLASS'],
  ['interface_declaration', 'INTERFACE'],
  ['trait_declaration', 'TRAIT'],
  ['enum_declaration', 'ENUM'],
]);

@Injectable()
export class PhpParserService {
  private static languagePromise: Promise<Language> | undefined;

  constructor(private readonly configService: ConfigService) {}

  async analyze(rootDir: string, relativeSourceFiles: string[]): Promise<PhpAnalysis> {
    const language = await PhpParserService.getLanguage();
    const parser = new Parser();
    parser.setLanguage(language);
    const maxChunkTokens = this.configService.get<number>(
      'INDEXING_MAX_CHUNK_TOKENS',
      DEFAULT_MAX_CHUNK_TOKENS,
    );
    const chunks: ParsedChunk[] = [];
    const candidates: PhpTestTargetCandidate[] = [];

    try {
      for (const filePath of relativeSourceFiles) {
        const source = await readFile(join(rootDir, filePath), 'utf8');
        parser.reset();
        const tree = parser.parse(source);

        if (!tree) {
          continue;
        }

        try {
          chunks.push(...this.parseFile(filePath, source, tree.rootNode, maxChunkTokens, candidates));
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }

    return { chunks, candidates };
  }

  private static getLanguage(): Promise<Language> {
    this.languagePromise ??= (async () => {
      await Parser.init();
      const grammarPath = fileURLToPath(import.meta.resolve('tree-sitter-php/tree-sitter-php.wasm'));
      return Language.load(grammarPath);
    })();
    return this.languagePromise;
  }

  private parseFile(
    filePath: string,
    source: string,
    root: SyntaxNode,
    maxChunkTokens: number,
    candidates: PhpTestTargetCandidate[],
  ): ParsedChunk[] {
    const chunks: ParsedChunk[] = [];
    let namespace = '';
    let imports: DeclaredPhpImport[] = [];

    for (const candidateNode of root.namedChildren) {
      if (!candidateNode) continue;
      const node = candidateNode;
      if (node.type === 'namespace_definition') {
        namespace = this.qualifiedName(node.childForFieldName('name')?.text ?? '');
        imports = [];
        const body = node.childForFieldName('body');

        if (body) {
          const scopeImports = this.collectImports(body.namedChildren);
          chunks.push(...this.parseDeclarations(filePath, body.namedChildren, namespace, scopeImports, source, maxChunkTokens, candidates));
        }
        continue;
      }

      if (node.type === 'namespace_use_declaration') {
        imports.push(...this.parseUseDeclaration(node.text));
        continue;
      }

      chunks.push(...this.parseDeclaration(filePath, node, namespace, imports, source, maxChunkTokens, candidates));
    }

    if (chunks.length === 0 && source.trim().length > 0) {
      chunks.push(...this.toChunks(filePath, 'FILE', null, null, source, 1, source.split('\n').length, [], maxChunkTokens));
    }

    return chunks;
  }

  private parseDeclarations(
    filePath: string,
    declarations: (SyntaxNode | null)[],
    namespace: string,
    imports: DeclaredPhpImport[],
    source: string,
    maxChunkTokens: number,
    candidates: PhpTestTargetCandidate[],
  ): ParsedChunk[] {
    return declarations.flatMap((node) => node
      ? this.parseDeclaration(filePath, node, namespace, imports, source, maxChunkTokens, candidates)
      : []);
  }

  private parseDeclaration(
    filePath: string,
    node: SyntaxNode,
    namespace: string,
    imports: DeclaredPhpImport[],
    source: string,
    maxChunkTokens: number,
    candidates: PhpTestTargetCandidate[],
  ): ParsedChunk[] {
    if (node.type === 'namespace_use_declaration') {
      return [];
    }

    const symbolKind = CLASS_NODES.get(node.type);

    if (symbolKind) {
      const shortName = node.childForFieldName('name')?.text;
      if (!shortName) return [];
      const className = this.qualify(namespace, shortName);
      const declarationChunks = this.toChunks(
        filePath, symbolKind, className, null, node.text, node.startPosition.row + 1,
        node.endPosition.row + 1, imports, maxChunkTokens,
      );
      const isClass = node.type === 'class_declaration';

      if (isClass) {
        candidates.push(this.candidate(filePath, className, null, TestTargetType.CLASS, node));
      }

      const body = node.childForFieldName('body');
      if (!body) return declarationChunks;

      const methodChunks = body.namedChildren.flatMap((member) => {
        if (member?.type !== 'method_declaration') return [];
        const methodName = member.childForFieldName('name')?.text;
        if (!methodName) return [];
        const constructor = methodName.toLowerCase() === '__construct';
        const kind: ChunkSymbolKind = constructor ? 'CONSTRUCTOR' : 'METHOD';
        const childChunks = this.toChunks(
          filePath, kind, constructor ? 'constructor' : methodName, className,
          member.text, member.startPosition.row + 1, member.endPosition.row + 1, imports, maxChunkTokens,
        );

        if (isClass && !constructor && this.isPublicMethod(member)) {
          candidates.push(this.candidate(filePath, className, methodName, TestTargetType.METHOD, member));
        }
        return childChunks;
      });

      // Traits contribute structural chunks, but are not directly test targets.
      return [...declarationChunks, ...methodChunks];
    }

    if (node.type === 'function_definition') {
      const name = node.childForFieldName('name')?.text;
      if (!name) return [];
      const qualifiedName = this.qualify(namespace, name);
      candidates.push(this.candidate(filePath, qualifiedName, null, TestTargetType.FUNCTION, node));
      return this.toChunks(
        filePath, 'FUNCTION', qualifiedName, null, node.text, node.startPosition.row + 1,
        node.endPosition.row + 1, imports, maxChunkTokens,
      );
    }

    return [];
  }

  private candidate(
    filePath: string,
    symbolName: string,
    methodName: string | null,
    targetType: TestTargetType,
    node: SyntaxNode,
  ): PhpTestTargetCandidate {
    return {
      filePath,
      symbolName,
      methodName,
      targetType,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private isPublicMethod(node: SyntaxNode): boolean {
    const visibility = node.namedChildren.find((child) => child?.type === 'visibility_modifier')?.text;
    return visibility !== 'private' && visibility !== 'protected';
  }

  private collectImports(nodes: (SyntaxNode | null)[]): DeclaredPhpImport[] {
    return nodes.flatMap((node) => node?.type === 'namespace_use_declaration'
      ? this.parseUseDeclaration(node.text)
      : []);
  }

  private parseUseDeclaration(value: string): DeclaredPhpImport[] {
    const match = value.match(/^\s*use\s+(?!function\b|const\b)([^;]+);/is);
    if (!match) return [];
    const body = match[1].trim();
    const group = body.match(/^([^{}]+)\{([^{}]+)\}$/s);
    const prefix = group ? group[1].trim().replace(/\\?$/, '') : '';
    const entries = (group ? group[2] : body).split(',');

    return entries.flatMap((entry) => {
      const item = entry.trim().replace(/^\\/, '');
      const parts = item.match(/^(.+?)(?:\s+as\s+(\w+))?$/i);
      if (!parts) return [];
      const moduleSpecifier = `${prefix}${prefix ? '\\' : ''}${parts[1].replace(/^\\/, '')}`;
      const alias = parts[2] ?? moduleSpecifier.split('\\').pop() ?? moduleSpecifier;
      return [{ moduleSpecifier, alias }];
    });
  }

  private toChunks(
    filePath: string,
    symbolKind: ChunkSymbolKind,
    symbolName: string | null,
    parentSymbolName: string | null,
    rawContent: string,
    startLine: number,
    endLine: number,
    imports: DeclaredPhpImport[],
    maxChunkTokens: number,
  ): ParsedChunk[] {
    const content = rawContent.trim();
    if (!content) return [];
    const parts = this.splitByLines(content, maxChunkTokens, startLine);
    const partsTotal = parts.length;

    return parts.map((part, index) => ({
      filePath,
      symbolKind,
      symbolName,
      parentSymbolName,
      startLine: part.startLine,
      endLine: Math.min(endLine, part.startLine + part.content.split('\n').length - 1),
      content: part.content,
      importsUsed: imports.filter((item) => new RegExp(`\\b${this.escapeRegExp(item.alias)}\\b`).test(part.content))
        .map((item) => item.moduleSpecifier).sort(),
      tokenCount: countTokens(part.content),
      partIndex: index + 1,
      partsTotal,
    }));
  }

  private splitByLines(content: string, maxTokens: number, startLine: number): Array<{ content: string; startLine: number }> {
    if (countTokens(content) <= maxTokens) return [{ content, startLine }];
    const parts: Array<{ content: string; startLine: number }> = [];
    let current = '';
    let currentStart = startLine;
    let lineNumber = startLine;

    for (const line of content.split(/(?<=\n)/)) {
      if (current && countTokens(current + line) > maxTokens) {
        parts.push({ content: current.trim(), startLine: currentStart });
        current = '';
        currentStart = lineNumber;
      }
      current += line;
      lineNumber += (line.match(/\n/g) ?? []).length;
    }
    if (current.trim()) parts.push({ content: current.trim(), startLine: currentStart });
    return parts;
  }

  private qualifiedName(name: string): string {
    return name.replace(/^\\+|\\+$/g, '');
  }

  private qualify(namespace: string, name: string): string {
    const cleanName = this.qualifiedName(name);
    return namespace ? `${namespace}\\${cleanName}` : cleanName;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

interface DeclaredPhpImport {
  moduleSpecifier: string;
  alias: string;
}
