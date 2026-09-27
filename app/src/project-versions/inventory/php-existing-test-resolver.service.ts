import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TestTargetType } from '../../generated/prisma/enums.js';
import type { ResolvedTestTarget } from './existing-test-resolver.service.js';
import type { PhpTestTargetCandidate } from '../parsing/php-parser.service.js';

@Injectable()
export class PhpExistingTestResolverService {
  async resolve(
    rootDir: string,
    testFiles: string[],
    candidates: PhpTestTargetCandidate[],
  ): Promise<ResolvedTestTarget[]> {
    const resolved: ResolvedTestTarget[] = candidates.map((candidate) => ({
      ...candidate,
      hasTest: false,
      testFilePaths: [],
    }));

    for (const testFilePath of testFiles) {
      const content = await readFile(join(rootDir, testFilePath), 'utf8');
      const importedNames = this.importedNames(content);

      for (const target of resolved) {
        const shortName = target.symbolName.split('\\').pop() ?? target.symbolName;
        const matchingNames = new Set([shortName, ...(importedNames.get(target.symbolName) ?? [])]);
        const symbolUsed = [...matchingNames].some((name) =>
          new RegExp(`\\b${this.escapeRegExp(name)}\\b`).test(content),
        );
        const methodUsed = target.targetType !== TestTargetType.METHOD
          || Boolean(target.methodName && new RegExp(`(?:->|::)\\s*${this.escapeRegExp(target.methodName)}\\s*\\(`).test(content));

        if (symbolUsed && methodUsed && !target.testFilePaths.includes(testFilePath)) {
          target.hasTest = true;
          target.testFilePaths.push(testFilePath);
        }
      }
    }

    return resolved;
  }

  private importedNames(content: string): Map<string, Set<string>> {
    const namesByClass = new Map<string, Set<string>>();
    const usePattern = /^\s*use\s+([^;]+);/gim;

    for (const match of content.matchAll(usePattern)) {
      const clause = match[1].trim();
      if (/^(function|const)\s/i.test(clause)) continue;
      const group = clause.match(/^\\?(.+?)\\\{([^{}]+)\}$/);
      const prefix = group?.[1].replace(/\\$/, '');
      const clauses = (group ? group[2] : clause).split(',').map((item) =>
        prefix ? `${prefix}\\${item.trim()}` : item,
      );
      for (const item of clauses) {
        const parsed = item.trim().match(/^\\?(.+?)(?:\s+as\s+(\w+))?$/i);
        if (!parsed) continue;
        const fqn = parsed[1].replace(/^\\/, '');
        const alias = parsed[2] ?? fqn.split('\\').pop() ?? fqn;
        const aliases = namesByClass.get(fqn) ?? new Set<string>();
        aliases.add(alias);
        namesByClass.set(fqn, aliases);
      }
    }

    return namesByClass;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
