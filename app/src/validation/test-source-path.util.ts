/**
 * WI-CORE-044 (corte 4): decide si una ruta de archivo fuente es un archivo de test.
 *
 * Se usa solo para excluir símbolos de test de la selección de candidatos de generación
 * del validador (`analysis-run-validation-job.handler.ts`). No altera el pool de indexación
 * ni lo persistido en `analysis_symbols`.
 *
 * `projectRoot` es relativo a la raíz del repositorio (como `version.effectiveProjectRoot`);
 * '.' o '' significan raíz del repositorio. Las reglas de directorio se evalúan sobre la ruta
 * relativa a ese projectRoot. Si la ruta no está bajo projectRoot, se usa tal cual y no coincide
 * por directorio de test (las reglas por nombre de archivo sí se aplican).
 *
 * - PHP: directorio `tests` (minúsculas) solo como primer segmento relativo al projectRoot,
 *   o nombre de archivo `*Test.php`.
 * - TypeScript/JavaScript: nombre `*.spec|*.test` con extensión ts|tsx|js; segmento `__tests__`
 *   en cualquier posición; directorio `tests` o `test` solo como primer segmento relativo
 *   al projectRoot.
 *
 * Sin `language`, se aplican ambas familias de reglas.
 */
export function isTestSourcePath(
  filePath: string,
  language?: 'php' | 'typescript',
  projectRoot = '.',
): boolean {
  const segments = splitPath(filePath);
  const rootSegments = splitPath(projectRoot);
  const basename = segments[segments.length - 1] ?? '';
  const directories = segments.slice(0, -1);

  const underRoot =
    rootSegments.length === 0 ||
    (segments.length > rootSegments.length &&
      rootSegments.every((segment, index) => segments[index] === segment));
  const relativeDirectories = underRoot
    ? directories.slice(rootSegments.length)
    : [];
  const firstRelative = relativeDirectories[0];

  const phpMatch =
    firstRelative === 'tests' || basename.endsWith('Test.php');

  const lowerBasename = basename.toLowerCase();
  const tsMatch =
    /\.(spec|test)\.(ts|tsx|js)$/.test(lowerBasename) ||
    directories.includes('__tests__') ||
    firstRelative === 'tests' ||
    firstRelative === 'test';

  if (language === 'php') {
    return phpMatch;
  }
  if (language === 'typescript') {
    return tsMatch;
  }
  return phpMatch || tsMatch;
}

function splitPath(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}
