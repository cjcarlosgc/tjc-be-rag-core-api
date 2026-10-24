/**
 * CT-09-A4 (WI-CORE-089): test de arquitectura. Ningún SDK de proveedor de LLM se importa fuera de
 * `src/providers/`. Recorre `src/` y `test/` reales y, además, demuestra con un árbol temporal con una
 * importación prohibida que el detector sí falla (mutación en un directorio temporal, no en el repositorio).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scanProviderBoundary } from './testing/provider-boundary.scan.js';

/** Este archivo vive en `app/src/providers/`; `app/` es dos niveles arriba. */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('frontera de proveedor LLM (CT-09-A4)', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ningún archivo de src/ ni de test/ fuera de src/providers/ importa un SDK de proveedor', () => {
    expect(scanProviderBoundary(APP_ROOT)).toEqual([]);
  });

  it('detecta importaciones prohibidas en un árbol temporal y permite las de src/providers/', () => {
    const root = mkdtempSync(join(tmpdir(), 'provider-boundary-'));
    temporaryRoots.push(root);
    const write = (relativePath: string, content: string) => {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
    };
    write('src/providers/allowed.ts', "import OpenAI from 'openai';\n");
    write('src/domain/import-from.ts', "import OpenAI from 'openai';\n");
    write('src/domain/subpath.ts', "import type { Response } from 'openai/resources/responses/responses.js';\n");
    write('src/domain/dynamic.ts', "export const load = () => import('@anthropic-ai/sdk');\n");
    write('test/require.ts', "const sdk = require('@mistralai/mistralai');\n");
    write('src/domain/reexport.ts', "export * from 'cohere-ai';\n");
    write('src/domain/similar-name.ts', "import { helper } from 'openai-helpers';\n");
    write('src/domain/mock-only.spec.ts', "vi.mock('openai', () => ({}));\n");

    expect(scanProviderBoundary(root)).toEqual([
      { file: 'src/domain/dynamic.ts', specifier: '@anthropic-ai/sdk' },
      { file: 'src/domain/import-from.ts', specifier: 'openai' },
      { file: 'src/domain/reexport.ts', specifier: 'cohere-ai' },
      { file: 'src/domain/subpath.ts', specifier: 'openai/resources/responses/responses.js' },
      { file: 'test/require.ts', specifier: '@mistralai/mistralai' },
    ]);
  });
});
