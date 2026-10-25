/**
 * CT-10-A5 (WI-CORE-099): test de arquitectura de la frontera de adapters.
 *
 *  (i)  Ningún SDK de proveedor (`openai`, `@anthropic-ai/*`, `@supabase/supabase-js`) se importa fuera de los
 *       adapters: `src/providers/**` y `src/object-storage/*adapter*`.
 *  (ii) `PrismaService` solo lo usa la capa de persistencia: `*.repository.ts`, `persistence/**`, `src/prisma/**` y
 *       la lista permitida explícita de excepciones declaradas adapters (G-07 / D-6).
 *
 * Recorre `src/` y `test/` reales y demuestra, con árboles temporales (no con el repositorio), que cada detector falla
 * ante una infracción. Complementa `src/providers/provider-boundary.architecture.spec.ts` (CT-09-A4), que solo cubre
 * los SDK de LLM; no lo modifica ni lo importa (su lista no incluye Supabase).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/** Este archivo vive en `app/src/ct/`; `app/` es dos niveles arriba. */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------------------------------------------
// Declaraciones (fuente de verdad de la frontera)
// ---------------------------------------------------------------------------------------------------------------

/** Rutas (POSIX, relativas a `app/`) donde sí se pueden importar SDK de proveedor. */
const SDK_ADAPTER_PATH_PATTERNS: readonly RegExp[] = [
  /^src\/providers\//,
  /^src\/object-storage\/[^/]*adapter[^/]*$/,
];

/**
 * Rutas (POSIX, relativas a `app/`) de código de producción que declaran adapters de persistencia y por tanto pueden
 * usar `PrismaService` sin ser `*.repository.ts` ni vivir en `persistence/`. Decisión G-07 / D-6: la lista es
 * explícita; añadir un archivo exige una decisión, no un cambio silencioso.
 */
const DECLARED_PERSISTENCE_ADAPTERS: readonly string[] = ['src/common/idempotency/idempotency.service.ts'];

const PRISMA_ADAPTER_PATH_PATTERNS: readonly RegExp[] = [
  /\.repository\.ts$/,
  /(^|\/)persistence\//,
  /^src\/prisma\//,
];

// ---------------------------------------------------------------------------------------------------------------
// Detectores
// ---------------------------------------------------------------------------------------------------------------

interface SdkViolation {
  file: string;
  specifier: string;
}

const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

function isProviderSdkSpecifier(specifier: string): boolean {
  return (
    specifier === 'openai' ||
    specifier.startsWith('openai/') ||
    specifier === '@supabase/supabase-js' ||
    specifier.startsWith('@supabase/supabase-js/') ||
    specifier.startsWith('@anthropic-ai/')
  );
}

function importedSpecifiers(content: string): string[] {
  const found: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of content.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** Importaciones de SDK de proveedor fuera de los adapters, sobre `src/` y `test/` (`vi.mock('…')` no cuenta). */
function scanSdkBoundary(appRoot: string): SdkViolation[] {
  const violations: SdkViolation[] = [];
  for (const absoluteFile of listFiles(appRoot, ['src', 'test'])) {
    const file = posixRelative(appRoot, absoluteFile);
    if (SDK_ADAPTER_PATH_PATTERNS.some((pattern) => pattern.test(file))) continue;
    for (const specifier of importedSpecifiers(readFileSync(absoluteFile, 'utf8'))) {
      if (isProviderSdkSpecifier(specifier)) violations.push({ file, specifier });
    }
  }
  return sortBy(violations, (v) => `${v.file}\u0000${v.specifier}`);
}

function isTestCode(file: string): boolean {
  return /\.(spec|e2e-spec)\.ts$/.test(file) || file.startsWith('test/') || file.startsWith('src/generated/');
}

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Archivos de producción de `src/` que mencionan `PrismaService` (import o identificador, sin contar comentarios)
 * fuera de repositorios, `persistence/`, `src/prisma/` y la lista permitida. El código de pruebas (`*.spec.ts`,
 * `*.e2e-spec.ts`, `test/`) queda fuera: los dobles y los arneses de acceso lo sustituyen o lo ejecutan a propósito.
 */
function scanPrismaBoundary(
  appRoot: string,
  allowList: readonly string[] = DECLARED_PERSISTENCE_ADAPTERS,
): string[] {
  const violations: string[] = [];
  for (const absoluteFile of listFiles(appRoot, ['src'])) {
    const file = posixRelative(appRoot, absoluteFile);
    if (isTestCode(file)) continue;
    if (PRISMA_ADAPTER_PATH_PATTERNS.some((pattern) => pattern.test(file))) continue;
    if (allowList.includes(file)) continue;
    if (/\bPrismaService\b/.test(stripComments(readFileSync(absoluteFile, 'utf8')))) violations.push(file);
  }
  return violations.sort();
}

function listFiles(appRoot: string, roots: string[]): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
    }
  };
  for (const root of roots) {
    const absolute = join(appRoot, root);
    if (isDirectory(absolute)) walk(absolute);
  }
  return files;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

// ---------------------------------------------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------------------------------------------

describe('frontera de adapters de proveedor y persistencia (C-10)', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function makeTree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'ct-10-architecture-'));
    temporaryRoots.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
    }
    return root;
  }

  it('CT-10-A5: ningún SDK de proveedor (openai, @anthropic-ai/*, @supabase/supabase-js) se importa fuera de los adapters de src/ y test/', () => {
    expect(scanSdkBoundary(APP_ROOT)).toEqual([]);
  });

  it('CT-10-A5: los adapters declarados siguen importando su SDK (la excepción no es letra muerta)', () => {
    const adapterImports = listFiles(APP_ROOT, ['src'])
      .map((absolute) => posixRelative(APP_ROOT, absolute))
      .filter((file) => SDK_ADAPTER_PATH_PATTERNS.some((pattern) => pattern.test(file)))
      .filter((file) => importedSpecifiers(readFileSync(join(APP_ROOT, file), 'utf8')).some(isProviderSdkSpecifier));

    expect(adapterImports).toEqual(
      expect.arrayContaining([
        'src/object-storage/supabase-object-storage.adapter.ts',
        'src/providers/openai-embedding.provider.ts',
        'src/providers/openai-llm.provider.ts',
      ]),
    );
  });

  it('CT-10-A5: el detector de SDK falla ante importaciones prohibidas en un árbol temporal y permite las de los adapters', () => {
    // Las importaciones de muestra se componen en tiempo de ejecución para que este archivo no contenga ninguna
    // importación literal de un SDK (el propio test de arquitectura recorre `src/` y lo vería como infracción).
    const importFrom = (pkg: string) => `import X from '${pkg}';\n`;
    const dynamicImport = (pkg: string) => `export const load = () => import('${pkg}');\n`;
    const requireOf = (pkg: string) => `const sdk = require('${pkg}');\n`;
    const reexport = (pkg: string) => `export * from '${pkg}';\n`;
    const root = makeTree({
      'src/providers/allowed.ts': importFrom('openai'),
      'src/object-storage/supabase-object-storage.adapter.ts': importFrom('@supabase/supabase-js'),
      'src/object-storage/object-storage.service.ts': importFrom('@supabase/supabase-js'),
      'src/domain/openai.ts': importFrom('openai'),
      'src/domain/anthropic.ts': dynamicImport('@anthropic-ai/sdk'),
      'src/domain/anthropic-bedrock.ts': importFrom('@anthropic-ai/bedrock-sdk'),
      'test/supabase.ts': requireOf('@supabase/supabase-js'),
      'src/domain/subpath.ts': reexport('@supabase/supabase-js/dist/module/lib/types.js'),
      'src/domain/similar-name.ts': importFrom('openai-helpers'),
      'src/domain/mock-only.spec.ts': "vi.mock('@supabase/supabase-js', () => ({}));\n",
    });

    expect(scanSdkBoundary(root)).toEqual([
      { file: 'src/domain/anthropic-bedrock.ts', specifier: '@anthropic-ai/bedrock-sdk' },
      { file: 'src/domain/anthropic.ts', specifier: '@anthropic-ai/sdk' },
      { file: 'src/domain/openai.ts', specifier: 'openai' },
      { file: 'src/domain/subpath.ts', specifier: '@supabase/supabase-js/dist/module/lib/types.js' },
      { file: 'src/object-storage/object-storage.service.ts', specifier: '@supabase/supabase-js' },
      { file: 'test/supabase.ts', specifier: '@supabase/supabase-js' },
    ]);
  });

  it('CT-10-A5: PrismaService solo lo usan repositorios, persistence/, src/prisma/ y la lista permitida declarada', () => {
    expect(scanPrismaBoundary(APP_ROOT)).toEqual([]);
  });

  it('CT-10-A5: la lista permitida de adapters de persistencia es la declarada (G-07) y cada entrada sigue usando PrismaService', () => {
    expect(DECLARED_PERSISTENCE_ADAPTERS).toEqual(['src/common/idempotency/idempotency.service.ts']);
    for (const file of DECLARED_PERSISTENCE_ADAPTERS) {
      expect(readFileSync(join(APP_ROOT, file), 'utf8')).toMatch(/\bPrismaService\b/);
    }
  });

  it('CT-10-A5: sin la lista permitida, el único archivo que lo incumple es el declarado (el detector sí ve la excepción)', () => {
    expect(scanPrismaBoundary(APP_ROOT, [])).toEqual(['src/common/idempotency/idempotency.service.ts']);
  });

  it('CT-10-A5: el detector de PrismaService falla ante un servicio que lo inyecta fuera de la capa de persistencia', () => {
    const root = makeTree({
      'src/jobs/jobs.repository.ts': "import { PrismaService } from '../prisma/prisma.service.js';\n",
      'src/analysis-runs/persistence/analysis-trace.store.ts': 'constructor(private readonly prisma: PrismaService) {}\n',
      'src/prisma/prisma.module.ts': "import { PrismaService } from './prisma.service.js';\n",
      'src/common/idempotency/idempotency.service.ts': 'constructor(private readonly prisma: PrismaService) {}\n',
      'src/domain/rogue.service.ts': 'constructor(private readonly prisma: PrismaService) {}\n',
      'src/domain/rogue-type-only.ts': "import type { PrismaService } from '../prisma/prisma.service.js';\n",
      'src/domain/other-idempotency.service.ts': 'constructor(private readonly prisma: PrismaService) {}\n',
      'src/domain/commented.ts': "// usa PrismaService en un comentario\n/* PrismaService */\nexport const x = 1;\n",
      'src/domain/uses-repository.service.ts': 'constructor(private readonly jobs: JobsRepository) {}\n',
      'src/domain/rogue.service.spec.ts': 'const prisma = {} as PrismaService;\n',
      'src/generated/prisma/client.ts': 'export class PrismaService {}\n',
      'test/support/harness.ts': "import { PrismaService } from '../../src/prisma/prisma.service.js';\n",
    });

    expect(scanPrismaBoundary(root)).toEqual([
      'src/domain/other-idempotency.service.ts',
      'src/domain/rogue-type-only.ts',
      'src/domain/rogue.service.ts',
    ]);
    // La lista permitida es de rutas exactas: otro archivo no hereda la excepción (y una lista propia reemplaza a la declarada).
    expect(
      scanPrismaBoundary(root, [
        'src/common/idempotency/idempotency.service.ts',
        'src/domain/rogue.service.ts',
        'src/domain/rogue-type-only.ts',
      ]),
    ).toEqual(['src/domain/other-idempotency.service.ts']);
  });
});
