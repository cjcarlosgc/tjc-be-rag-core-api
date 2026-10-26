export const INDEXING_JOB_TYPE = 'project-version-indexing';

export const INDEXING_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'vendor',
  'storage',
  'cache',
]);

const CONFIG_FILE_PATTERNS = [
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^jest\.config\..+$/,
  /^vitest\.config\..+$/,
  /^composer\.json$/,
  /^composer\.lock$/,
  /^phpunit\.xml(?:\.dist)?$/,
];

export function isIgnoredPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => INDEXING_IGNORED_DIRS.has(segment));
}

export function isComposerManifest(relativePath: string): boolean {
  return relativePath.split('/').at(-1) === 'composer.json';
}

export function isSourceFile(relativePath: string): boolean {
  return isTypeScriptSourceFile(relativePath) || isPhpSourceFile(relativePath);
}

export function isTypeScriptSourceFile(relativePath: string): boolean {
  return /\.tsx?$/.test(relativePath);
}

export function isPhpSourceFile(relativePath: string): boolean {
  return /\.php$/i.test(relativePath) && !/\.blade\.php$/i.test(relativePath);
}

export function isTestFile(relativePath: string): boolean {
  return /\.(spec|test)\.tsx?$/.test(relativePath)
    || (/\.php$/i.test(relativePath)
      && (/(^|\/)tests?\//i.test(relativePath) || /(?:^|\/)[^/]*Test\.php$/i.test(relativePath)));
}

export function isConfigFile(relativePath: string): boolean {
  const baseName = relativePath.split('/').pop() ?? '';
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(baseName));
}

export function isPoolFile(relativePath: string): boolean {
  return !isIgnoredPath(relativePath) && (isSourceFile(relativePath) || isConfigFile(relativePath));
}

export function isTypeScriptPoolFile(relativePath: string): boolean {
  return !isIgnoredPath(relativePath)
    && (isTypeScriptSourceFile(relativePath) || /(^|\/)(?:package\.json|tsconfig\.json|pnpm-lock\.yaml)$/.test(relativePath)
      || /(^|\/)(?:jest|vitest)\.config\..+$/.test(relativePath));
}

export function isPhpPoolFile(relativePath: string): boolean {
  return !isIgnoredPath(relativePath)
    && (isPhpSourceFile(relativePath)
      || isComposerManifest(relativePath)
      || /(?:^|\/)(?:composer\.lock|phpunit\.xml(?:\.dist)?)$/i.test(relativePath));
}

/**
 * Fixtures de texto que viajan en el snapshot SOLO hacia el Sandbox (WI-CORE-102):
 * los tests PHP leen archivos como `examples/*.conf`. No forman parte del pool de
 * indexación ni de las herramientas del agente (`isPoolFile` no los reconoce).
 */
export const SANDBOX_FIXTURE_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 5_242_880,
  /** Margen bajo el tope de 100 del extractor seguro del Sandbox (que rechazaría TODO el snapshot). */
  maxCompressionRatio: 80,
} as const;

/** Nombres base de credenciales/secretos (auth.json de Composer, credentials.json, secrets.yml...): nunca viajan. */
export const SANDBOX_FIXTURE_SENSITIVE_NAME = /(^|[._-])(auth|credentials?|secrets?|service[-_]?account)([._-]|$)/i;

export const SANDBOX_FIXTURE_EXTENSIONS: ReadonlySet<string> = new Set([
  'conf',
  'csv',
  'tsv',
  'json',
  'yml',
  'yaml',
  'xml',
  'ini',
  'txt',
  'neon',
  'sql',
  'dist',
]);

const SANDBOX_FIXTURE_EXCLUDED_NAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

export function isSandboxFixtureFile(relativePath: string): boolean {
  // Un fixture nunca es archivo del pool (`isPoolFile` incluye package.json, tsconfig.json,
  // jest/vitest.config.*): de lo contrario reaparecería en `discover` y en las herramientas del agente.
  if (isPoolFile(relativePath) || isPhpPoolFile(relativePath) || isIgnoredPath(relativePath)) {
    return false;
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return false;
  }
  const name = (segments.at(-1) ?? '').toLowerCase();
  if (SANDBOX_FIXTURE_SENSITIVE_NAME.test(name)) {
    return false;
  }
  if (SANDBOX_FIXTURE_EXCLUDED_NAMES.has(name)) {
    return false;
  }
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return SANDBOX_FIXTURE_EXTENSIONS.has(name.slice(dot + 1));
}

/** Contenido del snapshot que recibe el Sandbox para proyectos PHP: pool PHP ∪ fixtures de texto. */
export function isSandboxSnapshotFile(relativePath: string): boolean {
  return isPhpPoolFile(relativePath) || isSandboxFixtureFile(relativePath);
}
