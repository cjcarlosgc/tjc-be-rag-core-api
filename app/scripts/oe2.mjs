#!/usr/bin/env node
// WI-CORE-107: CLI de evaluación OE2 (retrieval SE frente a SEM). Documentación de uso en app/scripts/README.md.
//   node scripts/oe2.mjs <subcomando> [opciones]
// Subcomandos: dump-chunks, dump-results, compare-dumps, sample, support-files, pool, score.
// Códigos de salida: 0 correcto; 1 error de ejecución, diferencias o incongruencias; 2 uso incorrecto.
// Solo dump-chunks y dump-results leen la base (sesión de solo lectura). El script NO carga .env.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { UsageError } from './evidence-extractor/options.mjs';
import { scrubSecrets, sensitiveValuesFrom } from './evidence-extractor/util.mjs';
import { openPrismaPgDriver } from './evidence-extractor/session.mjs';
import { HELP_TEXT, parseOe2Arguments } from './oe2/args.mjs';
import { Oe2ConfigError } from './oe2/db.mjs';
import { runDumpChunks } from './oe2/dump-chunks.mjs';
import { runDumpResults } from './oe2/dump-results.mjs';
import { runCompareDumps } from './oe2/compare-dumps.mjs';
import { runSample } from './oe2/sample.mjs';
import { runSupportFiles } from './oe2/support-files.mjs';
import { runPool } from './oe2/pool.mjs';
import { runScore } from './oe2/score.mjs';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const HANDLERS = Object.freeze({
  'dump-chunks': runDumpChunks,
  'dump-results': runDumpResults,
  'compare-dumps': runCompareDumps,
  sample: runSample,
  'support-files': runSupportFiles,
  pool: runPool,
  score: runScore,
});

/**
 * Ejecuta un subcomando y devuelve el código de salida. `io` inyecta stdout/stderr y el entorno para las pruebas;
 * `openDriver` inyecta el driver de base (en producción, el del extractor).
 */
export async function runCli(argv, io = {}) {
  const {
    env = process.env,
    cwd = process.cwd(),
    stdout = process.stdout,
    stderr = process.stderr,
    openDriver = openPrismaPgDriver,
    root = repoRoot,
  } = io;
  const secrets = sensitiveValuesFrom(env);
  const say = (stream, text) => stream.write(scrubSecrets(text, secrets));

  let parsed;
  try {
    parsed = parseOe2Arguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      say(stderr, `Error de uso: ${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
  if (parsed.help) {
    say(stdout, HELP_TEXT);
    return EXIT_OK;
  }

  try {
    const result = await HANDLERS[parsed.command]({
      options: parsed.options,
      env,
      cwd,
      repoRoot: root,
      openDriver,
    });
    say(stdout, `${result.lines.join('\n')}\n`);
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      say(stderr, `Error de uso: ${error.message}\n`);
      return EXIT_USAGE;
    }
    const prefix = error instanceof Oe2ConfigError ? 'Configuración' : 'Error';
    // Sin pila: los errores de la base o del sistema de archivos pueden arrastrar texto del proveedor.
    say(stderr, `${prefix}: ${error?.message ?? 'error desconocido'}\n`);
    return EXIT_ERROR;
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2));
}
