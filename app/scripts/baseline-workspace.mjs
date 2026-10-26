#!/usr/bin/env node
// WI-CORE-105 (C3): baseline sobre el mismo conjunto de archivos que recibió el Sandbox. Solo lectura sobre el
// checkout; escribe únicamente en --out. Documentación en app/scripts/README.md.
//
// Uso (desde tjc-be-rag-core-api/app):
//   node scripts/baseline-workspace.mjs --checkout <dir> --manifest <snapshot-manifest.json> --out <dir>
//                                       [--allow-out-in-repo]
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UsageError } from './evidence-extractor/options.mjs';
import {
  BASELINE_HELP_TEXT,
  formatBaselineSummary,
  parseBaselineArguments,
  runBaselineWorkspace,
} from './evidence-extractor/baseline-workspace.mjs';

const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main(argv) {
  try {
    const options = parseBaselineArguments(argv);
    if (options.help) {
      process.stdout.write(BASELINE_HELP_TEXT);
      return 0;
    }
    const result = await runBaselineWorkspace({ options, cwd: process.cwd(), repoRoot });
    process.stdout.write(formatBaselineSummary(result));
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`Error de uso: ${error.message}\n${BASELINE_HELP_TEXT.split('\n')[0]}\nUsa --help para ver las opciones.\n`);
      return EXIT_USAGE;
    }
    // Sin pila: solo el mensaje.
    process.stderr.write(`Error: ${error?.message ?? 'error desconocido'}\n`);
    return EXIT_ERROR;
  }
}

process.exitCode = await main(process.argv.slice(2));
