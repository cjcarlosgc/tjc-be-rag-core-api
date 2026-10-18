import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContractSchemaFile } from './contract-validator.js';
import { validateContract } from './contract-validator.js';

const examplesDir = resolve(__dirname, '../../../spec/contracts/schemas/examples');
const load = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(resolve(examplesDir, name), 'utf8')) as T;
const manifest = load<{ examples: { file: string; schema: ContractSchemaFile; definition: string }[] }>('manifest.json');

describe('esquemas canónicos (INTEROP-2.17 §10)', () => {
  it.each(manifest.examples)('el ejemplo $file es válido para $definition', ({ file, schema, definition }) => {
    const result = validateContract(schema, schema === 'error-envelope.schema.json' ? null : definition, load(file));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('un request rechaza campos no declarados (los servidores rechazan campos de request desconocidos)', () => {
    const request = { ...load('sandbox-create-request.node.json'), command: 'rm -rf /' };
    expect(validateContract('sandbox-execution.schema.json', 'CreateSandboxExecutionRequest', request).valid).toBe(false);
  });

  it('un request exige una URL HTTPS y un sha256 hexadecimal minúsculo', () => {
    const request = load<{ snapshot: Record<string, unknown> }>('sandbox-create-request.node.json');
    expect(validateContract('sandbox-execution.schema.json', 'CreateSandboxExecutionRequest', { ...request, snapshot: { ...request.snapshot, url: 'http://insegura.test/x' } }).valid).toBe(false);
    expect(validateContract('sandbox-execution.schema.json', 'CreateSandboxExecutionRequest', { ...request, snapshot: { ...request.snapshot, sha256: 'A'.repeat(64) } }).valid).toBe(false);
  });

  it('projectRoot y relativePath rechazan rutas absolutas y traversal', () => {
    const request = load<{ artifacts: Record<string, unknown>[] }>('sandbox-create-request.node.json');
    for (const bad of ['/etc/passwd', '../fuera', 'a/../../b', 'a\\b']) {
      const artifacts = [{ ...request.artifacts[0], relativePath: bad }];
      expect(validateContract('sandbox-execution.schema.json', 'CreateSandboxExecutionRequest', { ...request, artifacts }).valid, bad).toBe(false);
    }
  });

  it('RunnerFacts exige executionProfile (el desfase que tenía Core)', () => {
    const result = load<{ facts: Record<string, unknown> }>('sandbox-result.completed.json');
    const { executionProfile: _omitted, ...withoutProfile } = result.facts;
    expect(validateContract('sandbox-execution.schema.json', 'SandboxExecutionResultResponse', { ...result, facts: withoutProfile }).valid).toBe(false);
  });

  it('failureKind es opcional (un Sandbox anterior puede omitirlo) pero no admite valores fuera del contrato', () => {
    const result = load<{ facts: { testCases: Record<string, unknown>[] } }>('sandbox-result.completed.json');
    const omit = result.facts.testCases.map(({ failureKind: _f, ...rest }) => rest);
    expect(validateContract('sandbox-execution.schema.json', 'SandboxExecutionResultResponse', { ...result, facts: { ...result.facts, testCases: omit } }).valid).toBe(true);
    const bad = result.facts.testCases.map((tc) => ({ ...tc, failureKind: 'OTRO' }));
    expect(validateContract('sandbox-execution.schema.json', 'SandboxExecutionResultResponse', { ...result, facts: { ...result.facts, testCases: bad } }).valid).toBe(false);
  });

  it('las responses admiten campos aditivos (los consumidores ignoran lo desconocido)', () => {
    const result = { ...load('sandbox-result.completed.json'), campoNuevo: 1 };
    expect(validateContract('sandbox-execution.schema.json', 'SandboxExecutionResultResponse', result).valid).toBe(true);
  });

  it('el error envelope exige todos los campos y retryable es opcional', () => {
    const { path: _p, ...incomplete } = load('error-envelope.validation.json');
    expect(validateContract('error-envelope.schema.json', null, incomplete).valid).toBe(false);
    expect(validateContract('error-envelope.schema.json', null, load('error-envelope.validation.json')).valid).toBe(true);
  });
});
