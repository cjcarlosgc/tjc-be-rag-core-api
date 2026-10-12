// Smoke local Core → Sandbox (PHP/PHPUnit). Una sola ejecución; no reintenta.
// Uso: desde app/ con las variables SUPABASE_*, SANDBOX_* ya exportadas en el entorno del proceso.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const APP = process.cwd();
const SANDBOX_REPO = process.env.SANDBOX_REPO ?? '/Users/jean/Tesis/workspaces/tjc-be-test-execution-sandbox';
const { SandboxExecutionService } = await import(path.join(APP, 'dist/sandbox/sandbox-execution.service.js'));
const { SupabaseObjectStorageAdapter } = await import(path.join(APP, 'dist/object-storage/supabase-object-storage.adapter.js'));

const config = {
  get: (k, d) => {
    const v = process.env[k];
    if (v === undefined || v === '') return d;
    return /^\d+$/.test(v) ? Number(v) : v;
  },
  getOrThrow: (k) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} no configurado`);
    return v;
  },
};

// Almacenamiento real, con registro de las claves escritas para limpiarlas al final.
const real = new SupabaseObjectStorageAdapter(config);
const written = [];
const storage = {
  put: async (key, body, ct) => { written.push(key); return real.put(key, body, ct); },
  get: (key) => real.get(key),
  delete: (key) => real.delete(key),
  presignGet: (key, ttl) => real.presignGet(key, ttl),
};
const sandbox = new SandboxExecutionService(config, storage);

// Snapshot efímero: fixture PHPUnit del propio Sandbox, envuelto en una carpeta como los ZIP de GitHub.
const work = mkdtempSync(path.join(tmpdir(), 'php-smoke-'));
const wrapper = 'tjc-demo-php-0000001';
cpSync(path.join(SANDBOX_REPO, 'app/test/fixtures/phpunit-sample-project'), path.join(work, wrapper), { recursive: true });
const zipPath = path.join(work, 'snapshot.zip');
execFileSync('zip', ['-qr', zipPath, wrapper], { cwd: work });
const snapshotBuffer = readFileSync(zipPath);
const snapshotSha = createHash('sha256').update(snapshotBuffer).digest('hex');

const runId = randomUUID();
const snapshotKey = `smoke/php-local-${runId}/snapshot.zip`;
await storage.put(snapshotKey, snapshotBuffer, 'application/zip');

const addTest = `<?php

namespace Tests\\Unit;

use App\\Math;
use PHPUnit\\Framework\\TestCase;

final class AddTest extends TestCase
{
    public function testAddsTwoNumbers(): void
    {
        $this->assertSame(7, (new Math())->add(3, 4));
    }
}
`;
const identityTest = `<?php

namespace Tests\\Unit;

use PHPUnit\\Framework\\TestCase;

final class RuntimeIdentityTest extends TestCase
{
    public function testRunsAsSandboxUser(): void
    {
        $this->assertSame(10001, getmyuid());
    }

    public function testWorkingDirectoryIsNotTheHostPath(): void
    {
        $this->assertStringNotContainsString('/Users/', getcwd());
    }
}
`;

const request = {
  requestId: randomUUID(),
  testRunId: randomUUID(),
  projectVersionId: randomUUID(),
  snapshotKey,
  snapshotBuffer,
  artifacts: [
    { artifactId: randomUUID(), relativePath: 'tests/Unit/AddTest.php', artifactType: 'CREATED', content: Buffer.from(addTest) },
    { artifactId: randomUUID(), relativePath: 'tests/Unit/RuntimeIdentityTest.php', artifactType: 'CREATED', content: Buffer.from(identityTest) },
  ],
  scope: 'BATCH',
  targetIds: [randomUUID()],
  runnerHint: 'PHPUNIT',
  projectRoot: '.',
  executionProfile: 'PHP_LARAVEL_PHPUNIT',
};

let outcome;
try {
  const r = await sandbox.execute(request);
  outcome = { kind: 'RESULT', result: r };
} catch (e) {
  outcome = { kind: 'ERROR', name: e?.name, message: String(e?.message ?? e).slice(0, 400), executionId: e?.executionId ?? null };
} finally {
  let cleaned = 0;
  for (const key of written) {
    try { await storage.delete(key); cleaned += 1; } catch { /* se informa abajo */ }
  }
  rmSync(work, { recursive: true, force: true });
  console.log(JSON.stringify({ cleanup: { written: written.length, deleted: cleaned } }));
}

const summary = outcome.kind === 'RESULT'
  ? {
      kind: 'RESULT',
      status: outcome.result.status,
      executionId: outcome.result.executionId,
      requestId: outcome.result.requestId,
      correlationId: outcome.result.correlationId,
      executionProfile: outcome.result.executionProfile,
      durationMs: outcome.result.durationMs,
      stageDurations: outcome.result.stageDurations,
      failure: outcome.result.failure,
      facts: outcome.result.facts && {
        runner: outcome.result.facts.runner,
        compiled: outcome.result.facts.compiled,
        executed: outcome.result.facts.executed,
        passed: outcome.result.facts.passed,
        totalTests: outcome.result.facts.totalTests,
        passedTests: outcome.result.facts.passedTests,
        failedTests: outcome.result.facts.failedTests,
        testCases: outcome.result.facts.testCases.map((t) => ({ suitePath: t.suitePath, name: t.name, status: t.status, failureKind: t.failureKind ?? null, errorMessage: t.errorMessage })),
      },
    }
  : outcome;
console.log(JSON.stringify({ snapshotSha256: snapshotSha, requestId: request.requestId, summary }, null, 2));
