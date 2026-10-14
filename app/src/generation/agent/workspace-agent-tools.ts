import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { Parser, type Node as SyntaxNode, type Tree } from 'web-tree-sitter';
import { loadPhpLanguage } from '../../project-versions/parsing/php-parser.service.js';

const MAX_SEARCH_RESULTS = 30;
const PHP_DECLARATION_TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
  'function_definition',
]);
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
      /** Exigido por `strict: true` en Responses (WI-CORE-031). */
      additionalProperties: false;
    };
  };
}

export const AGENT_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'Lista las rutas relativas de todos los archivos disponibles del snapshot del proyecto.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
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
        additionalProperties: false,
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
        additionalProperties: false,
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
            description:
              'Nombre exacto del símbolo a inspeccionar: clase, interfaz, tipo, enum o función. En PHP también admite un método por nombre simple (`método`) o calificado (`Clase::método`, `Namespace\\Clase\\método`).',
          },
        },
        required: ['symbolName'],
        additionalProperties: false,
      },
    },
  },
];

const PHP_TYPE_WITH_METHODS_TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
]);

function namedChildrenOf(node: SyntaxNode): SyntaxNode[] {
  return (node.namedChildren ?? []).filter(
    (child): child is SyntaxNode => child !== null,
  );
}

/**
 * Devuelve el nodo que coincide con `target` dentro de una declaración PHP:
 * la propia declaración (nombre simple o calificado) o, para tipos con cuerpo,
 * uno de sus métodos (`<calificado>\m`, `<calificado>::m`, `<n>::m`, etc.).
 */
function matchPhpDeclaration(
  node: SyntaxNode,
  namespaceName: string,
  target: string,
): SyntaxNode | undefined {
  const simpleName = node.childForFieldName('name')?.text;
  if (!simpleName) {
    return undefined;
  }
  const qualifiedName = namespaceName
    ? `${namespaceName}\\${simpleName}`
    : simpleName;
  if (target === simpleName || target === qualifiedName) {
    return node;
  }
  if (!PHP_TYPE_WITH_METHODS_TYPES.has(node.type)) {
    return undefined;
  }
  const body = node.childForFieldName('body');
  if (!body) {
    return undefined;
  }
  return namedChildrenOf(body).find((member) => {
    if (member.type !== 'method_declaration') {
      return false;
    }
    const methodName = member.childForFieldName('name')?.text;
    if (!methodName) {
      return false;
    }
    return [
      `${qualifiedName}\\${methodName}`,
      `${qualifiedName}::${methodName}`,
      `${qualifiedName}.${methodName}`,
      `${simpleName}::${methodName}`,
      `${simpleName}.${methodName}`,
    ].includes(target);
  });
}

/**
 * Recorre las declaraciones PHP de primer nivel en orden de aparición, entrando
 * en namespaces con llaves. Un `namespace X;` sin cuerpo aplica a los hermanos siguientes.
 */
function* phpDeclarations(
  nodes: SyntaxNode[],
  initialNamespace: string,
): Generator<{ node: SyntaxNode; namespaceName: string }> {
  let currentNamespace = initialNamespace;
  for (const node of nodes) {
    if (node.type === 'namespace_definition') {
      const name = node.childForFieldName('name')?.text ?? '';
      const body = node.childForFieldName('body');
      if (body) {
        yield* phpDeclarations(namedChildrenOf(body), name);
      } else {
        currentNamespace = name;
      }
      continue;
    }
    if (PHP_DECLARATION_TYPES.has(node.type)) {
      yield { node, namespaceName: currentNamespace };
    }
  }
}

function findPhpDeclarationNode(
  root: SyntaxNode,
  target: string,
): SyntaxNode | undefined {
  for (const { node, namespaceName } of phpDeclarations(
    namedChildrenOf(root),
    '',
  )) {
    const match = matchPhpDeclaration(node, namespaceName, target);
    if (match) {
      return match;
    }
  }
  return undefined;
}

/** Métodos con ese nombre simple en tipos con cuerpo (class, interface, trait, enum). */
function findPhpMethodNodes(
  root: SyntaxNode,
  methodName: string,
): Array<{ className: string; node: SyntaxNode }> {
  const matches: Array<{ className: string; node: SyntaxNode }> = [];
  for (const { node } of phpDeclarations(namedChildrenOf(root), '')) {
    if (!PHP_TYPE_WITH_METHODS_TYPES.has(node.type)) {
      continue;
    }
    const className = node.childForFieldName('name')?.text;
    const body = node.childForFieldName('body');
    if (!className || !body) {
      continue;
    }
    for (const member of namedChildrenOf(body)) {
      if (
        member.type === 'method_declaration' &&
        member.childForFieldName('name')?.text === methodName
      ) {
        matches.push({ className, node: member });
      }
    }
  }
  return matches;
}

interface PhpSymbolMatch {
  content: string;
  startLine: number;
  endLine: number;
}

interface PhpMethodCandidate extends PhpSymbolMatch {
  filePath: string;
  className: string;
}

function toPhpSymbolMatch(node: SyntaxNode): PhpSymbolMatch {
  return {
    content: node.text.trim(),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

/** Nombre simple: sin `\`, `::` ni `.`. Solo entonces se admite un método suelto. */
function isSimpleSymbolName(symbolName: string): boolean {
  return !/\\|::|\./.test(symbolName);
}

/** Último segmento de un nombre calificado (`\`, `::` o `.`). */
function lastSymbolSegment(symbolName: string): string {
  const segments = symbolName.split(/\\|::|\./).filter(Boolean);
  return segments[segments.length - 1] ?? symbolName;
}

/**
 * Herramientas read-only del GENERALIST_AGENT (DEC-EXP-002), acotadas al
 * snapshot materializado del ProjectVersion. Las pruebas existentes son
 * visibles y legibles (DEC-EXP-003); solo se excluyen las rutas fuera del
 * snapshot (node_modules, .git, etc.) ya filtradas por FileDiscoveryService.
 */
export class WorkspaceAgentTools {
  private readonly allowedFiles: Set<string>;

  constructor(
    private readonly workspaceDir: string,
    poolFiles: string[],
  ) {
    this.allowedFiles = new Set(poolFiles);
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
        `No se puede leer "${relativePath}": no existe en el snapshot disponible.`,
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

  /**
   * Busca la primera declaración PHP (clase, interfaz, trait, enum o función)
   * con ese nombre corto, top-level o dentro de un namespace con llaves.
   * Archivos con errores de sintaxis no aportan declaraciones.
   */
  private async analyzePhpFile(
    content: string,
    symbolName: string,
    collectMethods: boolean,
  ): Promise<{
    declaration: PhpSymbolMatch | null;
    methods: Array<PhpSymbolMatch & { className: string }>;
  }> {
    const language = await loadPhpLanguage();
    const parser = new Parser();
    let tree: Tree | null = null;
    try {
      parser.setLanguage(language);
      tree = parser.parse(content);
      if (!tree || tree.rootNode.hasError) {
        return { declaration: null, methods: [] };
      }
      const node = findPhpDeclarationNode(tree.rootNode, symbolName);
      const methods = collectMethods
        ? findPhpMethodNodes(tree.rootNode, symbolName).map(
            ({ className, node: method }) => ({
              className,
              ...toPhpSymbolMatch(method),
            }),
          )
        : [];
      return {
        declaration: node ? toPhpSymbolMatch(node) : null,
        methods,
      };
    } finally {
      tree?.delete();
      parser.delete();
    }
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
    // Nombres PHP calificados (`App\Domain\OrderLine`) se normalizan sin `\` inicial.
    const phpSymbolName = symbolName.replace(/^\\/, '');
    const escapedSymbolName = lastSymbolSegment(phpSymbolName).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    const referencePattern = new RegExp(`\\b${escapedSymbolName}\\b`);
    // Métodos por nombre simple: solo si no hay ningún tipo/función con ese nombre.
    const collectMethods = isSimpleSymbolName(phpSymbolName);
    const methodCandidates: PhpMethodCandidate[] = [];

    for (const filePath of [...this.allowedFiles].sort()) {
      const isTypeScript = /\.tsx?$/.test(filePath);
      const isPhp = filePath.endsWith('.php');
      if (!isTypeScript && !isPhp) {
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

      if (!declaration && isPhp) {
        const analysis = await this.analyzePhpFile(
          content,
          phpSymbolName,
          collectMethods,
        );
        if (analysis.declaration) {
          declaration = { filePath, ...analysis.declaration };
        } else {
          methodCandidates.push(
            ...analysis.methods.map((method) => ({ filePath, ...method })),
          );
        }
      }

      if (!declaration && isTypeScript) {
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

    let ambiguity: string | null = null;
    if (!declaration && methodCandidates.length > 0) {
      // Los candidatos están en orden de ruta y, dentro de cada archivo, de posición.
      const [first] = methodCandidates;
      declaration = {
        filePath: first.filePath,
        content: first.content,
        startLine: first.startLine,
        endLine: first.endLine,
      };
      if (methodCandidates.length > 1) {
        const candidates = methodCandidates
          .map(
            ({ filePath, className }) =>
              `${filePath} (${className}::${symbolName})`,
          )
          .join(', ');
        ambiguity = `Ambiguo: ${methodCandidates.length} coincidencias para "${symbolName}": ${candidates}`;
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
      ...(ambiguity ? [ambiguity] : []),
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
