export const INDEXING_JOB_TYPE = 'project-version-indexing';

export const INDEXING_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
]);

const CONFIG_FILE_PATTERNS = [
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^jest\.config\..+$/,
  /^vitest\.config\..+$/,
];

export function isIgnoredPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => INDEXING_IGNORED_DIRS.has(segment));
}

export function isSourceFile(relativePath: string): boolean {
  return /\.tsx?$/.test(relativePath);
}

export function isTestFile(relativePath: string): boolean {
  return /\.(spec|test)\.tsx?$/.test(relativePath);
}

export function isConfigFile(relativePath: string): boolean {
  const baseName = relativePath.split('/').pop() ?? '';
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(baseName));
}

export function isPoolFile(relativePath: string): boolean {
  return !isIgnoredPath(relativePath) && (isSourceFile(relativePath) || isConfigFile(relativePath));
}
