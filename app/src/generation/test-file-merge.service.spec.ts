import { describe, expect, it } from 'vitest';
import { TestFileMergeService } from './test-file-merge.service.js';

describe('TestFileMergeService', () => {
  it('applyCreate returns the generated content trimmed with a trailing newline', () => {
    const service = new TestFileMergeService();

    expect(service.applyCreate('  export const x = 1;  \n\n')).toBe('export const x = 1;\n');
  });

  it('applyMerge appends new test blocks without touching existing ones', () => {
    const service = new TestFileMergeService();
    const existing = [
      "import { Greeter } from './greeter.js';",
      '',
      "test('existing case', () => {",
      '  expect(new Greeter().greet()).toBe("hi");',
      '});',
      '',
    ].join('\n');
    const generated = [
      "import { Greeter } from './greeter.js';",
      '',
      "test('new case', () => {",
      '  expect(new Greeter().farewell()).toBe("bye");',
      '});',
    ].join('\n');

    const merged = service.applyMerge(existing, generated);

    expect(merged).toContain("test('existing case'");
    expect(merged).toContain("test('new case'");
    // el import compartido no se duplica
    expect(merged.match(/from '\.\/greeter\.js'/g)).toHaveLength(1);
  });

  it('applyMerge adds a brand new import declaration used only by the generated block', () => {
    const service = new TestFileMergeService();
    const existing = ["test('a', () => { expect(1).toBe(1); });", ''].join('\n');
    const generated = [
      "import { helper } from './helper.js';",
      '',
      "test('b', () => { expect(helper()).toBe(true); });",
    ].join('\n');

    const merged = service.applyMerge(existing, generated);

    expect(merged).toMatch(/import \{ helper \} from ['"]\.\/helper\.js['"];/);
    expect(merged).toContain("test('a'");
    expect(merged).toContain("test('b'");
  });

  it('applyMerge adds a missing named import to an existing import from the same module', () => {
    const service = new TestFileMergeService();
    const existing = [
      "import { Greeter } from './greeter.js';",
      '',
      "test('a', () => { expect(new Greeter().greet()).toBeDefined(); });",
    ].join('\n');
    const generated = [
      "import { Greeter, Farewell } from './greeter.js';",
      '',
      "test('b', () => { expect(new Farewell().say()).toBeDefined(); });",
    ].join('\n');

    const merged = service.applyMerge(existing, generated);

    expect(merged).toMatch(/import \{ Greeter, Farewell \} from '\.\/greeter\.js';/);
  });
});
