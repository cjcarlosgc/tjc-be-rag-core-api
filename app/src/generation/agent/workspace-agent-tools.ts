import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Project } from 'ts-morph';

const MAX_SEARCH_RESULTS = 30;
const MAX_READ_CHARS = 20_000;

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
      description: 'Lee el contenido completo de un archivo del snapshot por su ruta relativa.',
      parameters: {
        type: 'object',
        properties: {
          relativePath: { type: 'string', description: 'Ruta relativa del archivo, ej. src/foo.ts' },
        },
        required: ['relativePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description: 'Busca un texto literal en todos los archivos disponibles (como grep) y devuelve las coincidencias con archivo y línea.',
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
          symbolName: { type: 'string', description: 'Nombre exacto del símbolo a inspeccionar.' },
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
    this.allowedFiles = new Set(poolFiles.filter((filePath) => !excluded.has(filePath)));
  }

  async dispatch(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'list_files':
        return this.listFiles();
      case 'read_file':
        return this.readFile(String(args.relativePath ?? ''));
      case 'search_text':
        return this.searchText(String(args.query ?? ''));
      case 'inspect_symbol':
        return this.inspectSymbol(String(args.symbolName ?? ''));
      default:
        return `Herramienta desconocida: "${name}".`;
    }
  }

  private listFiles(): string {
    return [...this.allowedFiles].sort().join('\n');
  }

  private async readFile(relativePath: string): Promise<string> {
    if (!this.allowedFiles.has(relativePath)) {
      return `No se puede leer "${relativePath}": no existe en el snapshot disponible o está excluido (test existente del target).`;
    }

    try {
      const content = await readFile(join(this.workspaceDir, relativePath), 'utf8');
      return content.length > MAX_READ_CHARS
        ? `${content.slice(0, MAX_READ_CHARS)}\n... (truncado)`
        : content;
    } catch {
      return `No se pudo leer "${relativePath}".`;
    }
  }

  private async searchText(query: string): Promise<string> {
    if (!query) {
      return 'Se requiere "query".';
    }

    const matches: string[] = [];

    for (const filePath of [...this.allowedFiles].sort()) {
      if (matches.length >= MAX_SEARCH_RESULTS) {
        break;
      }

      const content = await readFile(join(this.workspaceDir, filePath), 'utf8').catch(() => '');
      const lines = content.split('\n');

      for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_RESULTS; index += 1) {
        if (lines[index].includes(query)) {
          matches.push(`${filePath}:${index + 1}: ${lines[index].trim()}`);
        }
      }
    }

    return matches.length > 0 ? matches.join('\n') : `Sin coincidencias para "${query}".`;
  }

  private async inspectSymbol(symbolName: string): Promise<string> {
    if (!symbolName) {
      return 'Se requiere "symbolName".';
    }

    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: false },
    });

    let declaration: { filePath: string; content: string } | null = null;
    const referencedIn = new Set<string>();

    for (const filePath of [...this.allowedFiles].sort()) {
      if (!/\.tsx?$/.test(filePath)) {
        continue;
      }

      const content = await readFile(join(this.workspaceDir, filePath), 'utf8').catch(() => null);

      if (content === null) {
        continue;
      }

      if (!declaration) {
        const sourceFile = project.createSourceFile(`${filePath}.virtual.ts`, content);
        const named = [
          ...sourceFile.getClasses(),
          ...sourceFile.getFunctions(),
          ...sourceFile.getInterfaces(),
          ...sourceFile.getTypeAliases(),
          ...sourceFile.getEnums(),
        ].find((node) => node.getName() === symbolName);

        if (named) {
          declaration = { filePath, content: named.getFullText().trim() };
        }
      }

      if (new RegExp(`\\b${symbolName}\\b`).test(content)) {
        referencedIn.add(filePath);
      }
    }

    if (!declaration) {
      return `No se encontró una declaración de "${symbolName}" en los archivos disponibles.`;
    }

    const references = [...referencedIn].filter((filePath) => filePath !== declaration?.filePath);

    return [
      `Declarado en ${declaration.filePath}:`,
      declaration.content,
      '',
      references.length > 0
        ? `Referenciado también en: ${references.join(', ')}`
        : 'No se encontraron referencias en otros archivos.',
    ].join('\n');
  }
}
