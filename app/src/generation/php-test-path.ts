/**
 * Ubicación del test PHP generado (DEC-PHP-GEN-001, PROPUESTA). Un archivo nuevo por target;
 * nunca se fusiona con tests existentes en V1.
 */
export interface PhpTestLocationTarget {
  filePath: string;
  symbolName: string;
  methodName: string | null;
  targetType: 'METHOD' | 'FUNCTION';
}

export interface PhpTestLocation {
  relativePath: string;
  namespace: string;
}

const TESTS_ROOT = 'tests/Unit';
const TESTS_NAMESPACE = 'Tests\\Unit';

function shortName(qualifiedName: string): string {
  return qualifiedName.split('\\').pop() ?? qualifiedName;
}

function toPascalCase(name: string): string {
  return name
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function capitalizeSegment(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function phpTestLocation(
  target: PhpTestLocationTarget,
  existsInSnapshot: (relativePath: string) => boolean,
): PhpTestLocation {
  const filePath = target.filePath;
  const lastSlash = filePath.lastIndexOf('/');
  const directory = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';
  const isInsideApp = filePath.startsWith('app/');

  // Bajo app/ se descarta el prefijo "app/"; fuera de app/ se conserva la ruta completa.
  const relativeDirectory = isInsideApp ? directory.slice('app'.length).replace(/^\//, '') : directory;
  const directorySegments = relativeDirectory.split('/').filter((segment) => segment.length > 0);

  const namespaceSegments = isInsideApp
    ? directorySegments
    : directorySegments.map(capitalizeSegment);

  const className = shortName(target.symbolName);
  const baseName =
    target.targetType === 'METHOD' && target.methodName
      ? `${className}${toPascalCase(target.methodName)}`
      : toPascalCase(className);

  const directoryPath = [TESTS_ROOT, ...directorySegments].join('/');
  const namespace = [TESTS_NAMESPACE, ...namespaceSegments].join('\\');

  const preferredPath = `${directoryPath}/${baseName}Test.php`;
  const relativePath = existsInSnapshot(preferredPath)
    ? `${directoryPath}/${baseName}GeneratedTest.php`
    : preferredPath;

  return { relativePath, namespace };
}
