# WI-CORE-069 — revisión contractual

Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

## Veredicto

APROBADO CON OBSERVACIONES (2 menores, 0 bloqueantes). Cambio aditivo, `breaking: false` correcto; eventos CS-CORE-20261018-001..003 publicables tal cual.

## Evidencia

- `contracts:check` OK; vitest `src/contracts src/sandbox`: 7 archivos, 104 tests OK (los 8 ejemplos de `manifest.json` validan contra su esquema). Los WARN de "no cumple el esquema" en la salida son de mocks incompletos y solo avisan en log (decisión de INTEROP §10).
- `node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-069`: sin pendientes relevantes (los 3 eventos son para otros repos).
- sha256 reales = `changed`: SYSTEM `b70f9358…0444`, INTEROP `b9ed40dc…ea05`, GH `6c553ee8…565a`; árbol de schemas `c45e4513…1fa31b` reproducible con `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`.
- `sourceRevision` 67519a2 existe y es el último commit que toca `spec/contracts`.
- Coherencia: `retryable?` y `phase?` opcionales en esquema, prosa (INTEROP:66, :1373) y tipos generados (`app/src/contracts/generated/contract-types.ts:51,148`); `sandbox.types.ts:1-20` deriva del generado. Targets, scopePaths y `breaking` correctos.

## Hallazgos

1. (menor, 001/002/003 `changed`) La descripción del digest del árbol es ambigua: con rutas completas (`find spec/contracts/schemas`) el resultado es `3a6b321a…`, no `c45e4513…`. Solo coincide con rutas relativas desde `schemas/`. Sugerencia: precisar la receta en el informe de publicación (`harness/reports/wi-core-069-contract-sync-publication.md`); no cambiar los eventos.
2. (menor, `CS-CORE-20261018-003` requiredAction) Pide re-espejar "los 3 contratos", pero `../tjc-be-test-execution-sandbox/spec/contracts/` solo tiene `interoperability-contract.md` y `system-contract.md` (sin `github-integration-contract.md`). Sandbox debe interpretar que añade el tercero o documentar por qué no lo espeja. No bloquea.
3. (informativo) Un Sandbox anterior rechaza `phase` (request con `additionalProperties:false`); está declarado en INTEROP:1373 y en el esquema. Core no lo envía; sin riesgo hoy.

## Espejos (solo lectura)

- `error-envelope.schema.json` idéntico (`4c3af12e…`) en github-integration, sandbox y console.
- SYSTEM idéntico (`b70f9358…`) en los tres. GH idéntico en github-integration y console.
- INTEROP desfasado (`4bab54e8…` vs `b9ed40dc…`) en los tres: cubierto por la acción de re-espejar byte a byte de cada evento (diferencia = notas editoriales §5 y §10).
