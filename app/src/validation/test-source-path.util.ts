/**
 * WI-CORE-044 (corte 2): decide si una ruta de archivo fuente es un archivo de test.
 *
 * Se usa solo para excluir símbolos de test de la selección de candidatos de generación
 * del validador (`analysis-run-validation-job.handler.ts`). No altera el pool de indexación
 * ni lo persistido en `analysis_symbols`.
 *
 * - PHP: un segmento de directorio `tests`/`Tests` en cualquier posición, o nombre `*Test.php`.
 *   Coincidencia de segmento completo: `TestimonialService.php` o `contest.ts` no coinciden.
 * - TypeScript/JavaScript: `*.spec|*.test` con extensión ts|tsx|js, o segmento `__tests__`.
 *
 * Sin `language`, se aplican ambas familias de reglas.
 */
export function isTestSourcePath(
  filePath: string,
  language?: 'php' | 'typescript',
): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) => segment !== '');
  const basename = segments[segments.length - 1] ?? '';
  const directories = segments.slice(0, -1);

  const phpMatch =
    directories.some((segment) => segment === 'tests' || segment === 'Tests') ||
    basename.endsWith('Test.php');

  const lowerBasename = basename.toLowerCase();
  const lowerDirectories = directories.map((segment) => segment.toLowerCase());
  const tsMatch =
    /\.(spec|test)\.(ts|tsx|js)$/.test(lowerBasename) ||
    lowerDirectories.includes('__tests__');

  if (language === 'php') {
    return phpMatch;
  }
  if (language === 'typescript') {
    return tsMatch;
  }
  return phpMatch || tsMatch;
}
