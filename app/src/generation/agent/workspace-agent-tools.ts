import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Project } from 'ts-morph';

const MAX_SEARCH_RESULTS = 30;
const MAX_READ_CHARS = 20_000;
const MAX_OBSERVATION_SNIPPET_CHARS = 2_000;

export type AgentToolName =
  'list_files' | 'search_text' | 'inspect_symbol' | 'read_file';
export type AgentStepStatus = 'SUCCEEDED' | 'EMPTY' | 'FAILED';
export type AgentObservationKind =
  'FILE_LIST_SUMMARY' | 'TEXT_MATCH' | 'SYMBOL' | 'FILE_CONTENT';

export interface AgentSourceLineObservation {
  lineNumber: number;
  content: string;
}

export interface AgentSourceExcerptObservation {
  filePath: string;
  symbolName: string | null;
  parentSymbolName: string | null;
  startLine: number | null;
  endLine: number | null;
  snippet: string;
  before: AgentSourceLineObservation[];
  after: AgentSourceLineObservation[];
  contentSha256: string;
  truncated: boolean;
}

export interface AgentToolObservation {
  kind: AgentObservationKind;
  filePath: string | null;
  symbolName: string | null;
  excerpt: AgentSourceExcerptObservation | null;
  discoveredFilesCount: number | null;
}

export interface AgentToolDispatchResult {
  /** Exact string returned to the model as the tool message. */
  result: string;
  status: AgentStepStatus;
  observations: AgentToolObservation[];
  /** Kept outside the trajectory summary so callers can persist paths by page. */
  discoveredFiles?: string[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeExcerpt(
  filePath: string,
  snippet: string,
  options: {
    symbolName?: string | null;
    startLine?: number | null;
    endLine?: number | null;
    upstreamTruncated?: boolean;
  } = {},
): AgentSourceExcerptObservation {
  const boundedSnippet = snippet.slice(0, MAX_OBSERVATION_SNIPPET_CHARS);
  const lineCount =
    boundedSnippet.length === 0 ? 0 : boundedSnippet.split('\n').length;

  return {
    filePath,
    symbolName: options.symbolName ?? null,
    parentSymbolName: null,
    startLine: options.startLine ?? (lineCount > 0 ? 1 : null),
    endLine: options.endLine ?? (lineCount > 0 ? lineCount : null),
    snippet: boundedSnippet,
    before: [],
    after: [],
    contentSha256: sha256(boundedSnippet),
    truncated:
      Boolean(options.upstreamTruncated) ||
      boundedSnippet.length < snippet.length,
  };
}

function observation(
  kind: AgentObservationKind,
  fields: Partial<Omit<AgentToolObservation, 'kind'>> = {},
): AgentToolObservation {
  return {
    kind,
    filePath: fields.filePath ?? null,
    symbolName: fields.symbolName ?? null,
    excerpt: fields.excerpt ?? null,
    discoveredFilesCount: fields.discoveredFilesCount ?? null,
  };
}

function result(
  text: string,
  status: AgentStepStatus,
  observations: AgentToolObservation[] = [],
  discoveredFiles?: string[],
): AgentToolDispatchResult {
  return {
    result: text,
    status,
    observations,
    ...(discoveredFiles ? { discoveredFiles } : {}),
  };
}

export interface AgentToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export const AGENT_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'Lista las rutas relativas de todos los archivos disponibles del snapshot del proyecto (no incluye archivos de test que ya cubren el target actual).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Lee el contenido completo de un archivo del snapshot por su ruta relativa.',
      parameters: {
        type: 'object',
        properties: {
          relativePath: {
            type: 'string',
            description: 'Ruta relativa del archivo, ej. src/foo.ts',
          },
        },
        required: ['relativePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description:
        'Busca un texto literal en todos los archivos disponibles (como grep) y devuelve las coincidencias con archivo y línea.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_symbol',
      description:
        'Dado el nombre de una clase, función, interfaz, tipo o enum, devuelve dónde se declara (con su contenido) y en qué otros archivos se referencia.',
      parameters: {
        type: 'object',
        properties: {
          symbolName: {
            type: 'string',
            description: 'Nombre exacto del símbolo a inspeccionar.',
          },
        },
        required: ['symbolName'],
      },
    },
  },
];

/**
 * Herramientas read-only del GENERALIST_AGENT (DEC-EXP-002), acotadas al
 * snapshot materializado del ProjectVersion. Los archivos de test que ya
 * cubren el target actual quedan excluidos de `list_files`/`read_file`/
 * `search_text`/`inspect_symbol` para evitar que el agente copie la prueba
 * existente en vez de generarla.
 */
export class WorkspaceAgentTools {
  private readonly allowedFiles: Set<string>;

  constructor(
    private readonly workspaceDir: string,
    poolFiles: string[],
    excludedTestFiles: string[],
  ) {
    const excluded = new Set(excludedTestFiles);
    this.allowedFiles = new Set(
      poolFiles.filter((filePath) => !excluded.has(filePath)),
    );
  }

  async dispatch(name: string, args: Record<string, unknown>): Promise<string> {
    return (await this.dispatchWithObservations(name, args)).result;
  }

  async dispatchWithObservations(
    name: string,
    args: Record<string, unknown>,
  ): Promise<AgentToolDispatchResult> {
    switch (name) {
      case 'list_files':
        return this.listFilesWithObservation();
      case 'read_file':
        return this.readFileWithObservation(String(args.relativePath ?? ''));
      case 'search_text':
        return this.searchTextWithObservations(String(args.query ?? ''));
      case 'inspect_symbol':
        return this.inspectSymbolWithObservation(String(args.symbolName ?? ''));
      default:
        return result(`Herramienta desconocida: "${name}".`, 'FAILED');
    }
  }

  private listFilesWithObservation(): AgentToolDispatchResult {
    const discoveredFiles = [...this.allowedFiles].sort();
    return result(
      discoveredFiles.join('\n'),
      discoveredFiles.length > 0 ? 'SUCCEEDED' : 'EMPTY',
      [
        observation('FILE_LIST_SUMMARY', {
          discoveredFilesCount: discoveredFiles.length,
        }),
      ],
      discoveredFiles,
    );
  }

  private async readFileWithObservation(
    relativePath: string,
  ): Promise<AgentToolDispatchResult> {
    if (!this.allowedFiles.has(relativePath)) {
      return result(
        `No se puede leer "${relativePath}": no existe en el snapshot disponible o está excluido (test existente del target).`,
        'FAILED',
      );
    }

    try {
      const content = await readFile(
        join(this.workspaceDir, relativePath),
        'utf8',
      );
      const truncated = content.length > MAX_READ_CHARS;
      const toolResult = truncated
        ? `${content.slice(0, MAX_READ_CHARS)}\n... (truncado)`
        : content;
      const observationExcerpt = makeExcerpt(relativePath, toolResult, {
        upstreamTruncated: truncated,
      });
      return result(toolResult, toolResult.length > 0 ? 'SUCCEEDED' : 'EMPTY', [
        observation('FILE_CONTENT', {
          filePath: relativePath,
          excerpt: observationExcerpt,
        }),
      ]);
    } catch {
      return result(`No se pudo leer "${relativePath}".`, 'FAILED');
    }
  }

  private async searchTextWithObservations(
    query: string,
  ): Promise<AgentToolDispatchResult> {
    if (!query) {
      return result('Se requiere "query".', 'FAILED');
    }

    const matches: string[] = [];
    const observations: AgentToolObservation[] = [];
    let readFailures = 0;

    for (const filePath of [...this.allowedFiles].sort()) {
      if (matches.length >= MAX_SEARCH_RESULTS) {
        break;
      }

      const content = await readFile(
        join(this.workspaceDir, filePath),
        'utf8',
      ).catch(() => {
        readFailures += 1;
        return '';
      });
      const lines = content.split('\n');

      for (
        let index = 0;
        index < lines.length && matches.length < MAX_SEARCH_RESULTS;
        index += 1
      ) {
        if (lines[index].includes(query)) {
          const line = lines[index].trim();
          matches.push(`${filePath}:${index + 1}: ${line}`);
          observations.push(
            observation('TEXT_MATCH', {
              filePath,
              excerpt: makeExcerpt(filePath, line, {
                startLine: index + 1,
                endLine: index + 1,
              }),
            }),
          );
        }
      }
    }

    const toolResult =
      matches.length > 0
        ? matches.join('\n')
        : `Sin coincidencias para "${query}".`;
    const status: AgentStepStatus =
      readFailures > 0 ? 'FAILED' : matches.length > 0 ? 'SUCCEEDED' : 'EMPTY';
    return result(toolResult, status, observations);
  }

  private async inspectSymbolWithObservation(
    symbolName: string,
  ): Promise<AgentToolDispatchResult> {
    if (!symbolName) {
      return result('Se requiere "symbolName".', 'FAILED');
    }

    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });

    let declaration: {
      filePath: string;
      content: string;
      startLine: number;
      endLine: number;
    } | null = null;
    const referencedIn = new Set<string>();
    let readFailures = 0;
    const escapedSymbolName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const referencePattern = new RegExp(`\\b${escapedSymbolName}\\b`);

    for (const filePath of [...this.allowedFiles].sort()) {
      if (!/\.tsx?$/.test(filePath)) {
        continue;
      }

      const content = await readFile(
        join(this.workspaceDir, filePath),
        'utf8',
      ).catch(() => {
        readFailures += 1;
        return null;
      });

      if (content === null) {
        continue;
      }

      if (!declaration) {
        const sourceFile = project.createSourceFile(
          `${filePath}.virtual.ts`,
          content,
        );
        const named = [
          ...sourceFile.getClasses(),
          ...sourceFile.getFunctions(),
          ...sourceFile.getInterfaces(),
          ...sourceFile.getTypeAliases(),
          ...sourceFile.getEnums(),
        ].find((node) => node.getName() === symbolName);

        if (named) {
          declaration = {
            filePath,
            content: named.getFullText().trim(),
            startLine: named.getStartLineNumber(),
            endLine: named.getEndLineNumber(),
          };
        }
      }

      if (referencePattern.test(content)) {
        referencedIn.add(filePath);
      }
    }

    if (!declaration) {
      return result(
        `No se encontró una declaración de "${symbolName}" en los archivos disponibles.`,
        readFailures > 0 ? 'FAILED' : 'EMPTY',
      );
    }

    const references = [...referencedIn].filter(
      (filePath) => filePath !== declaration?.filePath,
    );

    const toolResult = [
      `Declarado en ${declaration.filePath}:`,
      declaration.content,
      '',
      references.length > 0
        ? `Referenciado también en: ${references.join(', ')}`
        : 'No se encontraron referencias en otros archivos.',
    ].join('\n');
    return result(toolResult, readFailures > 0 ? 'FAILED' : 'SUCCEEDED', [
      observation('SYMBOL', {
        filePath: declaration.filePath,
        symbolName,
        excerpt: makeExcerpt(declaration.filePath, declaration.content, {
          symbolName,
          startLine: declaration.startLine,
          endLine: declaration.endLine,
        }),
      }),
    ]);
  }
}
