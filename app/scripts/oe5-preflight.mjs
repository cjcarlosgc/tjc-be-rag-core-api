#!/usr/bin/env node
// WI-CORE-105: preflight por caso del Piloto v2 (OE5). Documentación en app/scripts/README.md.
//
// Uso (desde tjc-be-rag-core-api/app):
//   node scripts/oe5-preflight.mjs before --core-url <url> [--integration-url <url>] [--timeout-ms <n>] [--wait-ms <n>]
//   node scripts/oe5-preflight.mjs after --package <carpeta del extractor> [--expect-...] [--json <archivo>]
// `before` hace GET /health (nunca imprime cabeceras ni cuerpos); `after` es offline y solo escribe con --json.
import { UsageError } from './evidence-extractor/options.mjs';
import {
  PREFLIGHT_HELP_TEXT,
  parsePreflightArguments,
  runPreflightAfter,
  runPreflightBefore,
} from './evidence-extractor/preflight.mjs';

const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

async function main(argv) {
  try {
    const options = parsePreflightArguments(argv);
    if (options.help) {
      process.stdout.write(PREFLIGHT_HELP_TEXT);
      return 0;
    }
    const result =
      options.command === 'before'
        ? await runPreflightBefore({ options })
        : await runPreflightAfter({ options, cwd: process.cwd() });
    process.stdout.write(result.text);
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`Error de uso: ${error.message}\n${PREFLIGHT_HELP_TEXT.split('\n')[0]}\nUsa --help para ver las opciones.\n`);
      return EXIT_USAGE;
    }
    // Sin pila ni texto del proveedor: solo un mensaje fijo.
    process.stderr.write('Error: fallo inesperado del preflight.\n');
    return EXIT_ERROR;
  }
}

process.exitCode = await main(process.argv.slice(2));
