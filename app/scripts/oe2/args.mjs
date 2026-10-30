// WI-CORE-107: lectura de argumentos del CLI `scripts/oe2.mjs`. Función pura: no toca el disco ni la red. Cada
// subcomando declara sus opciones; una opción desconocida o repetida, o un valor ausente, es un error de uso (2).
// WI-CORE-108: `pool --guide` (obligatorio), `--roles` en pool/score/build-gt y el subcomando `build-gt`.
import { UsageError } from '../evidence-extractor/options.mjs';

export const SUBCOMMANDS = Object.freeze([
  'dump-chunks', 'dump-results', 'compare-dumps', 'sample', 'support-files', 'pool', 'score', 'build-gt',
]);

/** Roles del muestreo (`sample.csv`), en el orden canónico del sorteo. */
export const ROLE_NAMES = Object.freeze(['calibracion', 'oficial', 'reserva']);
/** Rol por defecto de `build-gt`: la verdad de terreno se construye solo para los targets oficiales. */
export const BUILD_GT_DEFAULT_ROLES = Object.freeze(['oficial']);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const INTEGER_PATTERN = /^[0-9]{1,6}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

/** Roles pedidos que no tienen ninguna fila en el sample (se avisan; no cambian el código de salida si queda otra). */
export function rolesWithoutRows(roles, sampleRows) {
  if (!Array.isArray(roles)) return [];
  return roles.filter((role) => !sampleRows.some((row) => row.role === role));
}

/**
 * Convierte el valor de `--roles` (lista separada por comas) en roles en orden canónico y sin duplicados. Sin valor
 * devuelve `null` (todos los roles). Lista vacía, elemento vacío o rol desconocido: error de uso. No repite el valor.
 */
export function parseRoles(text) {
  if (text === undefined || text === null) return null;
  const tokens = String(text).split(',').map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) {
    throw new UsageError('--roles no puede estar vacío ni tener elementos vacíos (valores: calibracion, oficial, reserva)');
  }
  if (tokens.some((token) => !ROLE_NAMES.includes(token))) {
    throw new UsageError('--roles tiene un rol desconocido (valores: calibracion, oficial, reserva)');
  }
  return ROLE_NAMES.filter((role) => tokens.includes(role));
}

/** Opciones admitidas por subcomando: `value` (texto), `repeat` (texto repetible), `int`, `flag` (booleana). */
const SPEC = Object.freeze({
  'dump-chunks': { value: ['--project-version'], flag: ['--allow-out-in-repo'], out: 'required' },
  'dump-results': {
    value: ['--analysis-run'], repeat: ['--comparison'], flag: ['--allow-out-in-repo'], out: 'required',
  },
  'compare-dumps': { value: ['--a', '--b'], flag: ['--allow-out-in-repo'], out: 'optional' },
  sample: {
    value: ['--dump', '--seed', '--exclude', '--repo'],
    int: ['--calibration', '--reserve', '--official'],
    flag: ['--allow-out-in-repo'],
    out: 'required',
  },
  'support-files': { value: ['--sample', '--checkout'], flag: ['--allow-out-in-repo'], out: 'required' },
  pool: {
    value: ['--dump', '--sample', '--results', '--seed', '--guide', '--roles'],
    int: ['--max-chars'],
    flag: ['--allow-out-in-repo'],
    out: 'required',
  },
  score: {
    value: ['--results', '--gt', '--gt-sha256', '--sample', '--roles'],
    flag: ['--include-calibration', '--allow-out-in-repo'],
    out: 'required',
  },
  'build-gt': {
    value: ['--template', '--key', '--sample', '--sheets', '--roles'],
    flag: ['--allow-out-in-repo'],
    out: 'required',
  },
});

const DEFAULTS = Object.freeze({
  calibration: 3,
  reserve: 3,
  official: 12,
  maxChars: 6000,
});

/** Nombre de la propiedad de `options` para un flag `--kebab-case`. */
export function optionName(flag) {
  return flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Texto de ayuda de un subcomando o general. */
export const HELP_TEXT = `Uso (desde tjc-be-rag-core-api/app):
  node scripts/oe2.mjs <subcomando> [opciones]

Subcomandos (WI-CORE-107, evaluación OE2 de retrieval; solo lectura salvo la escritura en --out):
  dump-chunks     --project-version <id> --out <carpeta>            Volcado de chunks (lee la base).
  dump-results    (--analysis-run <id> | --comparison <id>...) --out <carpeta>
                                                                    Comparaciones COMPLETED como JSON (lee la base).
  compare-dumps   --a <chunks.jsonl> --b <chunks.jsonl> [--out <carpeta>]
                                                                    Compara dos volcados; sale con 1 si difieren.
  sample          --dump <chunks.jsonl> --seed <texto> --out <carpeta> [--calibration 3] [--reserve 3]
                  [--official 12] [--exclude <archivo>] [--repo <nombre>]
  support-files   --sample <sample.csv> --checkout <carpeta> --out <carpeta>
  pool            --dump <chunks.jsonl> --sample <sample.csv> --results <carpeta> --seed <texto>
                  --guide <guia.md> --out <carpeta> [--max-chars 6000] [--roles calibracion,oficial,reserva]
                  (--guide es obligatorio: la guía de anotación la redacta el equipo y la tool solo la copia)
  score           --results <carpeta> --gt <gt.json> --gt-sha256 <hex> --sample <sample.csv> --out <carpeta>
                  [--include-calibration] [--roles calibracion,oficial,reserva]
  build-gt        --template <annotation-template.csv adjudicada> --key <key.json> --sample <sample.csv>
                  --sheets <carpeta ciego/hojas del paquete entregado> --out <carpeta> [--roles oficial]
                  (--sheets es obligatorio: comprueba que la llave y la plantilla son de la misma ejecución de pool;
                  gt.json, gt.sha256, gt-summary.csv, manifest.json)

Comunes: --allow-out-in-repo (permite --out dentro del repositorio). --out debe estar vacía o no existir.
--roles sin valor usa todos los roles (pool, score) o «oficial» (build-gt).
Variables: DATABASE_URL solo para dump-chunks y dump-results (el script NO carga .env).

Códigos de salida: 0 correcto; 1 error de ejecución o diferencias/incongruencias; 2 uso incorrecto.
`;

/**
 * Convierte `argv` (sin `node` ni el nombre del script) en `{ help, command, options }`. Sin subcomando o con
 * `--help` devuelve `help: true`. Valida tipos, obligatorios y formatos de identificadores y de SHA-256.
 */
export function parseOe2Arguments(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true, command: null, options: {} };
  }
  const [command, ...rest] = argv;
  if (!SUBCOMMANDS.includes(command)) throw new UsageError('subcomando desconocido (ver --help)');
  const spec = SPEC[command];
  const allowed = new Set([
    ...(spec.value ?? []), ...(spec.repeat ?? []), ...(spec.int ?? []), ...(spec.flag ?? []), '--out', '--help',
  ]);

  const options = { out: null, allowOutInRepo: false, includeCalibration: false, comparisons: [] };
  const seen = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--help' || flag === '-h') {
      return { help: true, command, options: {} };
    }
    if (!allowed.has(flag)) throw new UsageError(`opción no admitida para ${command} (ver --help)`);
    const name = optionName(flag);
    if (spec.flag?.includes(flag)) {
      options[name] = true;
      continue;
    }
    if (seen.has(flag) && !spec.repeat?.includes(flag)) throw new UsageError(`la opción ${flag} está repetida`);
    seen.add(flag);
    index += 1;
    const value = rest[index];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`la opción ${flag} necesita un valor`);
    if (spec.repeat?.includes(flag)) {
      options.comparisons.push(value);
      continue;
    }
    if (spec.int?.includes(flag)) {
      if (!INTEGER_PATTERN.test(value)) throw new UsageError(`${flag} debe ser un entero no negativo`);
      options[name] = Number(value);
      continue;
    }
    options[name] = value;
  }

  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    if (!(name in options) && (spec.int ?? []).some((flag) => optionName(flag) === name)) options[name] = fallback;
  }
  if (spec.out === 'required' && (options.out === null || options.out === undefined)) {
    throw new UsageError('falta --out <carpeta>');
  }
  if (options.out !== null && options.out.trim().length === 0) throw new UsageError('--out no puede estar vacío');
  validateCommand(command, options);
  return { help: false, command, options };
}

function requireOption(options, name, flag) {
  if (typeof options[name] !== 'string' || options[name].trim().length === 0) {
    throw new UsageError(`falta ${flag}`);
  }
}

function validateCommand(command, options) {
  switch (command) {
    case 'dump-chunks':
      requireOption(options, 'projectVersion', '--project-version');
      requireId(options.projectVersion, '--project-version');
      break;
    case 'dump-results': {
      const hasRun = typeof options.analysisRun === 'string';
      const hasIds = options.comparisons.length > 0;
      if (hasRun === hasIds) throw new UsageError('indica --analysis-run <id> o uno o más --comparison <id> (no ambos)');
      if (hasRun) requireId(options.analysisRun, '--analysis-run');
      for (const id of options.comparisons) requireId(id, '--comparison');
      break;
    }
    case 'compare-dumps':
      requireOption(options, 'a', '--a');
      requireOption(options, 'b', '--b');
      break;
    case 'sample':
      requireOption(options, 'dump', '--dump');
      requireOption(options, 'seed', '--seed');
      if (options.calibration + options.reserve + options.official === 0) {
        throw new UsageError('el sorteo debe pedir al menos un target');
      }
      break;
    case 'support-files':
      requireOption(options, 'sample', '--sample');
      requireOption(options, 'checkout', '--checkout');
      break;
    case 'pool':
      requireOption(options, 'dump', '--dump');
      requireOption(options, 'sample', '--sample');
      requireOption(options, 'results', '--results');
      requireOption(options, 'seed', '--seed');
      requireOption(options, 'guide', '--guide');
      if (options.maxChars < 200) throw new UsageError('--max-chars debe ser al menos 200');
      options.roles = parseRoles(options.roles);
      break;
    case 'score':
      requireOption(options, 'results', '--results');
      requireOption(options, 'gt', '--gt');
      requireOption(options, 'gtSha256', '--gt-sha256');
      requireOption(options, 'sample', '--sample');
      if (!SHA256_PATTERN.test(options.gtSha256)) throw new UsageError('--gt-sha256 debe ser un SHA-256 hexadecimal');
      options.gtSha256 = options.gtSha256.toLowerCase();
      options.roles = parseRoles(options.roles);
      break;
    case 'build-gt':
      requireOption(options, 'template', '--template');
      requireOption(options, 'key', '--key');
      requireOption(options, 'sample', '--sample');
      requireOption(options, 'sheets', '--sheets');
      options.roles = options.roles === undefined ? [...BUILD_GT_DEFAULT_ROLES] : parseRoles(options.roles);
      break;
    default:
      break;
  }
}

function requireId(value, flag) {
  if (!ID_PATTERN.test(value)) throw new UsageError(`el id de ${flag} no tiene un formato válido`);
}

export { DEFAULTS as OE2_DEFAULTS };
