import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FinalArtifactInput {
  relativePath: string;
  content: string;
  isNewFile: boolean;
  originalContent: string | null;
  valid: boolean;
}

/**
 * Rastrea el contenido evolutivo de los archivos de test tocados durante un
 * TestGenerationRun. Un mismo archivo puede recibir CREATE/MERGE de varios
 * targets del mismo run; esta clase asegura que cada nuevo target parta del
 * estado ya evolucionado (no del original en disco) y que la identidad
 * CREATED/MODIFIED del archivo se decida una sola vez, en su primer toque.
 */
export class WorkspaceFileTracker {
  private readonly current = new Map<string, string>();
  private readonly originals = new Map<string, string>();
  private readonly createdPaths = new Set<string>();
  private readonly validByPath = new Map<string, boolean>();

  constructor(private readonly workspaceDir: string) {}

  async getCurrent(relativePath: string): Promise<{ content: string | null; isNewFile: boolean }> {
    if (this.current.has(relativePath)) {
      return {
        content: this.current.get(relativePath) as string,
        isNewFile: this.createdPaths.has(relativePath),
      };
    }

    try {
      const content = await readFile(join(this.workspaceDir, relativePath), 'utf8');
      this.originals.set(relativePath, content);
      this.current.set(relativePath, content);
      return { content, isNewFile: false };
    } catch {
      this.createdPaths.add(relativePath);
      this.current.set(relativePath, '');
      return { content: null, isNewFile: true };
    }
  }

  set(relativePath: string, content: string): void {
    this.current.set(relativePath, content);
  }

  setValid(relativePath: string, valid: boolean): void {
    this.validByPath.set(relativePath, valid);
  }

  getFinalFiles(): FinalArtifactInput[] {
    return [...this.current.entries()].map(([relativePath, content]) => ({
      relativePath,
      content,
      isNewFile: this.createdPaths.has(relativePath),
      originalContent: this.originals.get(relativePath) ?? null,
      valid: this.validByPath.get(relativePath) ?? false,
    }));
  }
}
