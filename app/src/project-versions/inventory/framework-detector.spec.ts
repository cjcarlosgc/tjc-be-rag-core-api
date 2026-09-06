import { describe, expect, it } from 'vitest';
import { detectFramework } from './framework-detector.js';

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
