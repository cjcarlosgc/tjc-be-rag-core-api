# WI-CORE-039 — Implementación contractual

Modelo: leader · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `xhigh`

## Resultado

Se consolidó el alcance aprobado en `GH-INTEROP-1.6` sin cambios de aplicación. El contrato exige HTTP 422 inequívoco más una reconciliación completa de la identidad exacta con cero candidatos antes de persistir `CREATE_REJECTED`; un replay idéntico devuelve `422 GITHUB_CHECK_CREATE_REJECTED` (`retryable: false`) sin otro POST ni contenido crudo de GitHub. Un candidato único se adopta/actualiza, varios conservan la respuesta de ambigüedad y una búsqueda incompleta mantiene `CREATE_UNKNOWN`/`RECONCILIATION_REQUIRED` sin otro POST. Un request corregido solo puede reintentar con huella distinta tras cero candidatos y transición durable serializada.

Se actualizó la referencia vigente del contrato GH en SYSTEM-2.7 y el plan de la feature, además de registrar el cambio en `CHANGELOG.md`. No se cambió la versión ni la conducta de INTEROP-2.8. El cambio no implica implementación en GitHub Integration, despliegue, cutover, provisión ni edición de otro repositorio.

## Archivos afectados

- `spec/contracts/github-integration-contract.md`
- `spec/contracts/system-contract.md`
- `spec/features/016-github-integration/tasks.md`
- `spec/features/016-github-integration/plan.md`
- `CHANGELOG.md`
- `harness/work-items.json`
- `harness/state.json`
- `harness/reports/wi-core-039-scope-approval.md`
- `harness/reports/wi-core-039-contract-sync-scope-review.md`
- `harness/reports/wi-core-039-contract-sync-checkpoints.md`
- `harness/reports/wi-core-039-implementation.md`

## Evidencia y verificaciones

- Alcance autorizado: `harness/reports/wi-core-039-scope-approval.md`.
- `node scripts/sdd-check.mjs` — pasó.
- `node harness/validate-work-items.mjs` — pasó (CORE, 39 WI).
- `node harness/validate-harness.mjs` — pasó (incluye las pruebas locales de validadores y Contract Sync).
- `git diff --check` — pasó.
- `CS-GH-20261011-002` pasó a `C-RESOLVED` con este reporte como evidencia.
- Contract Sync `implementation-delivery` y `before-review` pasaron sin eventos relevantes pendientes; los dos eventos históricos ajenos al WI quedaron clasificados `NOT_RELEVANT` con digest verificado.

No se ejecutaron lint/build de la aplicación porque este WI no modifica `app/`; los gates locales del Harness y SDD sí fueron ejecutados.
