import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Detector de fronteras de proveedor (WI-CORE-089, CT-09-A4). Recorre `src/` y `test/` bajo `appRoot` y devuelve
 * cada importación de un SDK de proveedor fuera de `src/providers/`. Cuenta `import … from`, `export … from`,
 * `import '…'`, `import('…')` y `require('…')`. No cuenta `vi.mock('…')`: un mock no carga el SDK en el código
 * de producción y el espacio de nombres de las pruebas de dominio se valida por esta misma regla.
 */

/** SDK de proveedores de LLM que solo pueden importarse dentro de `src/providers/`. */
export const PROVIDER_SDK_PACKAGES: readonly string[] = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@azure/openai',
  'cohere-ai',
  '@mistralai/mistralai',
];

/** Directorio permitido para importar SDK de proveedor, relativo a `appRoot`, con separador POSIX. */
const ALLOWED_DIRECTORY = 'src/providers/';
const SCANNED_ROOTS = ['src', 'test'];

export interface ProviderBoundaryViolation {
  /** Ruta relativa a `appRoot`, con separador POSIX. */
  file: string;
  specifier: string;
}

const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

export function isProviderSdkSpecifier(specifier: string): boolean {
  return PROVIDER_SDK_PACKAGES.some(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  );
}

export function scanProviderBoundary(appRoot: string): ProviderBoundaryViolation[] {
  const violations: ProviderBoundaryViolation[] = [];
  for (const root of SCANNED_ROOTS) {
    const absoluteRoot = join(appRoot, root);
    if (!isDirectory(absoluteRoot)) continue;
    for (const absoluteFile of listTypeScriptFiles(absoluteRoot)) {
      const file = relative(appRoot, absoluteFile).split(sep).join('/');
      if (file.startsWith(ALLOWED_DIRECTORY)) continue;
      const content = readFileSync(absoluteFile, 'utf8');
      for (const specifier of importedSpecifiers(content)) {
        if (isProviderSdkSpecifier(specifier)) violations.push({ file, specifier });
      }
    }
  }
  return violations.sort((a, b) =>
    a.file === b.file ? a.specifier.localeCompare(b.specifier) : a.file.localeCompare(b.file),
  );
}

function importedSpecifiers(content: string): string[] {
  const found: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found;
}

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
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
