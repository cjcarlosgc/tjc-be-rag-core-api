// WI-CORE-094: lectura de argumentos de línea de comandos del extractor. Función pura: no toca el disco ni la red.

/** Tope por defecto de un objeto de Storage: 5 MiB. Límite máximo admitido: 64 MiB. */
export const DEFAULT_STORAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_STORAGE_MAX_BYTES = 64 * 1024 * 1024;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export const HELP_TEXT = `Uso (desde tjc-be-rag-core-api/app):
  node scripts/extract-evidence.mjs --out <carpeta> [--analysis-run <id>] [--experiment <id>]
                                    [--include-pii] [--allow-out-in-repo]

Opciones:
  --out <carpeta>        Carpeta de salida del paquete. Obligatoria. Debe estar vacía o no existir.
  --analysis-run <id>    Id de un AnalysisRun.
  --experiment <id>      Id de un ExperimentRun. Si tiene analysisRunId, se extrae también ese AnalysisRun.
  --include-pii          Incluye actorLogin, prTitle, refs/branchName y la URL del companion PR (por defecto se
                         anonimizan u omiten).
  --allow-out-in-repo    Permite una --out dentro del repositorio (por defecto se rechaza).
  --storage-max-bytes <n> Tope de tamaño por objeto de Storage (por defecto 5242880; máximo 67108864). Un objeto
                         mayor se declara ausente en el manifiesto.
  --help                 Muestra esta ayuda y sale.

Se requiere al menos --analysis-run o --experiment.

Variables de entorno (las exporta el operador en SU shell; el script NO carga .env):
  DATABASE_URL             Obligatoria. Conexión de solo lectura (rol propietario) a la base de desarrollo.
  SUPABASE_URL             Opcional. Con SUPABASE_SECRET_KEY y SUPABASE_STORAGE_BUCKET descarga los test generados.
  SUPABASE_SECRET_KEY      Opcional. Solo se usa para descargar objetos (download).
  SUPABASE_STORAGE_BUCKET  Opcional. Bucket de Storage del producto.

Códigos de salida: 0 correcto; 1 error de ejecución; 2 uso incorrecto.
`;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function parsePositiveInteger(text, max) {
  if (!/^[1-9][0-9]{0,11}$/.test(text)) throw new UsageError('--storage-max-bytes debe ser un entero positivo');
  const value = Number(text);
  if (value > max) throw new UsageError(`--storage-max-bytes no puede superar ${max}`);
  return value;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`la opción ${flag} necesita un valor`);
  }
  return value;
}

/**
 * Convierte `argv` (sin `node` ni el nombre del script) en opciones validadas. `--help` no exige el resto.
 * Nunca repite en el mensaje de error un argumento no reconocido: solo indica que existe.
 */
export function parseArguments(argv) {
  const options = {
    help: false,
    out: null,
    analysisRunId: null,
    experimentId: null,
    includePii: false,
    allowOutInRepo: false,
    storageMaxBytes: DEFAULT_STORAGE_MAX_BYTES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--out':
        index += 1;
        options.out = takeValue(argv, index, '--out');
        break;
      case '--analysis-run':
        index += 1;
        options.analysisRunId = takeValue(argv, index, '--analysis-run');
        break;
      case '--experiment':
        index += 1;
        options.experimentId = takeValue(argv, index, '--experiment');
        break;
      case '--include-pii':
        options.includePii = true;
        break;
      case '--allow-out-in-repo':
        options.allowOutInRepo = true;
        break;
      case '--storage-max-bytes':
        index += 1;
        options.storageMaxBytes = parsePositiveInteger(takeValue(argv, index, '--storage-max-bytes'), MAX_STORAGE_MAX_BYTES);
        break;
      default:
        throw new UsageError('argumento desconocido (ver --help)');
    }
  }
  if (options.help) return options;
  if (options.out === null) throw new UsageError('falta --out <carpeta>');
  if (options.out.trim().length === 0) throw new UsageError('--out no puede estar vacío');
  if (options.analysisRunId === null && options.experimentId === null) {
    throw new UsageError('indica --analysis-run <id> y/o --experiment <id>');
  }
  if (options.analysisRunId !== null && !ID_PATTERN.test(options.analysisRunId)) {
    throw new UsageError('el id de --analysis-run no tiene un formato válido');
  }
  if (options.experimentId !== null && !ID_PATTERN.test(options.experimentId)) {
    throw new UsageError('el id de --experiment no tiene un formato válido');
  }
  return options;
}
