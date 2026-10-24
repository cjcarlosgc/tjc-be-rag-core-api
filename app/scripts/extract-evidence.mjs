#!/usr/bin/env node
// WI-CORE-094: extractor de evidencia de solo lectura para AnalysisRun y ExperimentRun.
// Documentación de uso completa en app/scripts/README.md.
//
// Uso (desde tjc-be-rag-core-api/app):
//   node scripts/extract-evidence.mjs --out <carpeta> [--analysis-run <id>] [--experiment <id>]
//                                     [--include-pii] [--allow-out-in-repo]
//
// Variables de entorno que el operador exporta en SU shell (este script NO carga .env):
//   DATABASE_URL, y opcionalmente SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET.
// Nunca imprime ni escribe esos valores; los mensajes de error se sanean antes de mostrarse.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HELP_TEXT, UsageError, parseArguments } from './evidence-extractor/options.mjs';
import { createSupabaseDownloader } from './evidence-extractor/storage.mjs';
import { openPrismaPgDriver } from './evidence-extractor/session.mjs';
import { ConfigError, runExtraction } from './evidence-extractor/index.mjs';
import { scrubSecrets, sensitiveValuesFrom } from './evidence-extractor/util.mjs';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

/** Valores que nunca se muestran: variables completas y usuario, contraseña y host de los DSN, por separado. */
function secretValues(env) {
  return sensitiveValuesFrom(env);
}

async function main(argv, env) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`Error de uso: ${error.message}\n${HELP_TEXT.split('\n')[0]}\nUsa --help para ver las opciones.\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return EXIT_OK;
  }

  try {
    const result = await runExtraction({
      options,
      env,
      cwd: process.cwd(),
      repoRoot,
      now: () => new Date(),
      openDriver: openPrismaPgDriver,
      createStorage: createSupabaseDownloader,
    });
    const { summary } = result;
    process.stdout.write(
      [
        `Paquete escrito en: ${result.outDir}`,
        `Archivos: ${summary.files}. Ausencias declaradas: ${summary.absences}. Truncados: ${summary.truncations}.`,
        `Hashes: coinciden ${summary.hashVerification['coincide']}, no coinciden ${summary.hashVerification['no coincide']}, no verificables ${summary.hashVerification['no verificable']}.`,
        'Revisa manifest.json (ausencias y truncados) antes de usar el paquete.',
        '',
      ].join('\n'),
    );
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`Error de uso: ${scrubSecrets(error.message, secretValues(env))}\n`);
      return EXIT_USAGE;
    }
    const prefix = error instanceof ConfigError ? 'Configuración' : 'Error';
    // Sin pila: un error de la base o de Storage puede arrastrar texto del proveedor; solo se muestra el mensaje saneado.
    process.stderr.write(`${prefix}: ${scrubSecrets(error?.message ?? 'error desconocido', secretValues(env))}\n`);
    return EXIT_ERROR;
  }
}

process.exitCode = await main(process.argv.slice(2), process.env);
