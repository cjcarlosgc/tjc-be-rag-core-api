// WI-CORE-094: política de datos personales del paquete. Por defecto, `actorLogin`, `prTitle`, refs/`branchName` y la
// URL del companion PR se ANONIMIZAN (hash estable y truncado con una sal fija del paquete) u OMITEN; solo se
// incluyen con `--include-pii`. El manifiesto registra cada decisión. La anonimización es seudonimización: con una
// sal pública, un valor corto y conocido puede reconstruirse por fuerza bruta; por eso no es un sustituto de no
// compartir el paquete.
import { createHmac } from 'node:crypto';

/** Sal fija del esquema del paquete (versión 1). Cambiarla cambia todos los seudónimos. */
export const PII_SALT = 'tjc-core-evidence-package/v1';

/**
 * Campos de texto libre que NO pasan por la política: pueden contener logins, ramas, URLs o fragmentos de código de
 * terceros. Se copian tal cual y el manifiesto los declara en `piiResidual`. No se redactan por defecto.
 */
export const PII_RESIDUAL_FIELDS = Object.freeze([
  'test_publications.failureMessage',
  'analysis_runs.resultSummary',
  'generated_test_proposals.failureSummary',
  'generated_test_proposals.generation',
  'experiment_runs.failureMessage',
  'analysis_contexts.omittedFunctionalRules',
  'analysis_run_executions.failure',
  'context-traces.json (fragmentos de código en detail)',
  'experiment_repetitions.errorSummary / failure (copia redactada en experiment.json y repetitions.csv)',
]);

export const PII_RESIDUAL_NOTE =
  'repositoryName + prNumber identifican el PR en un repositorio público; con ellos el actorLogin seudonimizado puede recuperarse en GitHub. Los campos de texto libre listados no se tratan por la política.';

export const PII_RULES = Object.freeze([
  { table: 'analysis_runs', field: 'actorLogin', defaultAction: 'anonymized' },
  { table: 'analysis_runs', field: 'prTitle', defaultAction: 'omitted' },
  { table: 'analysis_runs', field: 'baseRef', defaultAction: 'anonymized' },
  { table: 'analysis_runs', field: 'headRef', defaultAction: 'anonymized' },
  { table: 'test_publications', field: 'branchName', defaultAction: 'anonymized' },
  { table: 'test_publications', field: 'companionPullRequestUrl', defaultAction: 'anonymized' },
]);

/** Seudónimo estable: `anon-` + 16 caracteres hexadecimales de HMAC-SHA256(sal, valor). */
export function pseudonymize(value) {
  return `anon-${createHmac('sha256', PII_SALT).update(String(value), 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * Crea la política para un paquete. `apply(table, field, value)` devuelve el valor a escribir y registra la
 * decisión; `report()` devuelve las decisiones agregadas para el manifiesto.
 */
export function createPiiPolicy({ includePii }) {
  const decisions = new Map();

  function record(table, field, action) {
    const key = `${table}.${field}.${action}`;
    const current = decisions.get(key) ?? { table, field, action, count: 0 };
    current.count += 1;
    decisions.set(key, current);
  }

  return {
    includePii: includePii === true,
    apply(table, field, value) {
      const rule = PII_RULES.find((candidate) => candidate.table === table && candidate.field === field);
      if (!rule) return value;
      if (value === null || value === undefined) return value;
      if (includePii === true) {
        record(table, field, 'included');
        return value;
      }
      if (rule.defaultAction === 'omitted') {
        record(table, field, 'omitted');
        return null;
      }
      record(table, field, 'anonymized');
      return pseudonymize(value);
    },
    report() {
      const rules = PII_RULES.map((rule) => `${rule.table}.${rule.field}`);
      return {
        mode: includePii === true ? 'incluido (--include-pii)' : 'anonimizado u omitido (por defecto)',
        fields: rules,
        piiResidual: { fields: [...PII_RESIDUAL_FIELDS], note: PII_RESIDUAL_NOTE },
        decisions: [...decisions.values()].sort((a, b) =>
          `${a.table}.${a.field}`.localeCompare(`${b.table}.${b.field}`) || a.action.localeCompare(b.action),
        ),
      };
    },
  };
}
