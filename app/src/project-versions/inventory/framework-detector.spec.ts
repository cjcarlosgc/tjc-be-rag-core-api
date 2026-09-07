import { describe, expect, it } from 'vitest';
import { detectFramework, findPackageJsonPath } from './framework-detector.js';

describe('detectFramework', () => {
  it('detects Vitest from a config file', () => {
    expect(detectFramework(undefined, ['vitest.config.ts'])).toBe('VITEST');
  });

  it('detects Jest from a config file', () => {
    expect(detectFramework(undefined, ['jest.config.js'])).toBe('JEST');
  });

  it('detects Vitest from package.json devDependencies', () => {
    const pkg = JSON.stringify({ devDependencies: { vitest: '^2.0.0' } });
    expect(detectFramework(pkg, ['package.json'])).toBe('VITEST');
  });

  it('detects Jest from package.json dependencies', () => {
    const pkg = JSON.stringify({ dependencies: { jest: '^29.0.0' } });
    expect(detectFramework(pkg, ['package.json'])).toBe('JEST');
  });

  it('returns null when there is no signal at all', () => {
    expect(detectFramework(JSON.stringify({}), ['package.json'])).toBeNull();
  });

  it('returns null when both frameworks are present (no inventar)', () => {
    const pkg = JSON.stringify({ devDependencies: { jest: '^29.0.0', vitest: '^2.0.0' } });
    expect(detectFramework(pkg, ['package.json'])).toBeNull();
  });

  it('returns null for malformed package.json instead of throwing', () => {
    expect(() => detectFramework('{not json', [])).not.toThrow();
    expect(detectFramework('{not json', [])).toBeNull();
  });
});

describe('findPackageJsonPath', () => {
  it('returns undefined when no package.json exists', () => {
    expect(findPackageJsonPath(['src/index.ts'])).toBeUndefined();
  });

  it('returns the root package.json when present at the ZIP root', () => {
    expect(findPackageJsonPath(['package.json', 'src/index.ts'])).toBe('package.json');
  });

  it('finds package.json nested inside a wrapping folder (common ZIP export shape)', () => {
    expect(findPackageJsonPath(['my-project/package.json', 'my-project/src/index.ts'])).toBe(
      'my-project/package.json',
    );
  });

  it('prefers the shallowest package.json when several exist (e.g. a monorepo)', () => {
    expect(
      findPackageJsonPath(['my-project/package.json', 'my-project/packages/lib/package.json']),
    ).toBe('my-project/package.json');
  });
});
