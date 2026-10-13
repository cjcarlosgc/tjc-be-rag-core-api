import { describe, expect, it, vi } from 'vitest';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import type { CodeChunksRepository } from '../project-versions/persistence/code-chunks.repository.js';

const NS = 'Pilot\\Subscriptions\\Services';
const DECLARING = `${NS}\\RenewalService`;
const CONTRACTS = 'Pilot\\Subscriptions\\Contracts';
const DOMAIN = 'Pilot\\Subscriptions\\Domain';
const FILE = 'src/Services/RenewalService.php';

const methodChunk = {
  filePath: FILE,
  symbolKind: 'METHOD',
  symbolName: `${DECLARING}::renew`,
  parentSymbolName: DECLARING,
  importsUsed: [`${DOMAIN}\\Subscription`],
  content: 'public function renew(Subscription $subscription): void {}',
};

function makeRepository(overrides: { files?: unknown[]; types?: string[]; error?: Error } = {}) {
  const findByFile = overrides.error
    ? vi.fn().mockRejectedValue(overrides.error)
    : vi.fn().mockResolvedValue(
        overrides.files ?? [
          {
            filePath: FILE,
            symbolKind: 'CLASS',
            symbolName: DECLARING,
            parentSymbolName: null,
            importsUsed: [`${CONTRACTS}\\PaymentGateway`, `${DOMAIN}\\Subscription`],
            content: 'class RenewalService {}',
          },
          {
            filePath: FILE,
            symbolKind: 'CONSTRUCTOR',
            symbolName: '__construct',
            parentSymbolName: DECLARING,
            importsUsed: [`${CONTRACTS}\\PaymentGateway`],
            content: 'public function __construct(private PaymentGateway $payments, private RenewalDatePolicy $dates) {}',
          },
        ],
      );
  const findPhpTypeSymbolNames = vi.fn().mockResolvedValue(overrides.types ?? [`${NS}\\RenewalDatePolicy`, `${DOMAIN}\\Subscription`]);
  const repository = { findByFile, findPhpTypeSymbolNames } as unknown as CodeChunksRepository;
  return { findByFile, findPhpTypeSymbolNames, service: new PhpDependencyContextService(repository) };
}

describe('PhpDependencyContextService.resolve', () => {
  it('devuelve entradas, texto y tokens para un método PHP', async () => {
    const { service, findByFile } = makeRepository();

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(findByFile).toHaveBeenCalledWith('version-1', FILE);
    expect(result).not.toBeNull();
    expect(result?.entries.map((entry) => [entry.typeName, entry.fqcn, entry.resolvedBy])).toEqual([
      ['PaymentGateway', `${CONTRACTS}\\PaymentGateway`, 'IMPORT'],
      ['RenewalDatePolicy', `${NS}\\RenewalDatePolicy`, 'SAME_NAMESPACE'],
      ['Subscription', `${DOMAIN}\\Subscription`, 'IMPORT'],
    ]);
    expect(result?.unresolvedCount).toBe(0);
    expect(result?.truncated).toBe(false);
    expect(result?.text).toContain(`- RenewalDatePolicy → ${NS}\\RenewalDatePolicy (constructor)`);
    expect(result?.tokenCount).toBeGreaterThan(0);
    expect(result?.tokenCount).toBeLessThanOrEqual(300);
  });

  it('usa los tipos conocidos del repositorio para decidir SAME_NAMESPACE', async () => {
    const { service } = makeRepository({ types: [] });

    const result = await service.resolve('version-1', [methodChunk], 'php');

    expect(result?.entries.map((entry) => entry.typeName)).toEqual(['PaymentGateway', 'Subscription']);
    expect(result?.unresolvedCount).toBe(1);
  });

  it('devuelve null para TypeScript sin consultar el repositorio', async () => {
    const { service, findByFile, findPhpTypeSymbolNames } = makeRepository();

    const result = await service.resolve('version-1', [{ ...methodChunk, filePath: 'src/a.ts' }], 'typescript');

    expect(result).toBeNull();
    expect(findByFile).not.toHaveBeenCalled();
    expect(findPhpTypeSymbolNames).not.toHaveBeenCalled();
  });

  it('devuelve null si no hay chunk de método', async () => {
    const { service } = makeRepository();

    const result = await service.resolve('version-1', [{ ...methodChunk, symbolKind: 'CLASS' }], 'php');

    expect(result).toBeNull();
  });

  it('no propaga errores del repositorio y devuelve null con un warn', async () => {
    const { service } = makeRepository({ error: new TypeError('db down') });

    await expect(service.resolve('version-1', [methodChunk], 'php')).resolves.toBeNull();
  });
});
