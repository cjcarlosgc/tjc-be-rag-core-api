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
      || /^(?:composer\.json|composer\.lock|phpunit\.xml(?:\.dist)?)$/i.test(relativePath));
}
