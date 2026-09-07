import { TestFramework } from '../../generated/prisma/enums.js';

/**
 * Muchos ZIP subidos envuelven el proyecto en una carpeta contenedora
 * (p. ej. "mi-proyecto/package.json" en vez de "package.json" en la raíz
 * del ZIP), por lo que no se puede exigir coincidencia exacta con la raíz;
 * se toma el package.json con menor profundidad como el del proyecto.
 */
export function findPackageJsonPath(discoveredFiles: string[]): string | undefined {
  const candidates = discoveredFiles.filter((path) => path.split('/').pop() === 'package.json');

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((shallowest, candidate) =>
    candidate.split('/').length < shallowest.split('/').length ? candidate : shallowest,
  );
}

export function detectFramework(
  packageJsonContent: string | undefined,
  discoveredFiles: string[],
): TestFramework | null {
  const hasVitestConfig = discoveredFiles.some((path) => /(^|\/)vitest\.config\..+$/.test(path));
  const hasJestConfig = discoveredFiles.some((path) => /(^|\/)jest\.config\..+$/.test(path));

  let hasVitestDependency = false;
  let hasJestDependency = false;

  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasVitestDependency = 'vitest' in deps;
      hasJestDependency = 'jest' in deps;
    } catch {
      // package.json malformado: no se usa para detección, no se falla por esto.
    }
  }

  const isVitest = hasVitestConfig || hasVitestDependency;
  const isJest = hasJestConfig || hasJestDependency;

  if (isVitest && !isJest) {
    return TestFramework.VITEST;
  }

  if (isJest && !isVitest) {
    return TestFramework.JEST;
  }

  return null;
}
