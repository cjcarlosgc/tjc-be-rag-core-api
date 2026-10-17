# WI-CORE-011 — Revisión contractual

**Rol:** `contract-reviewer` del Harness. **Veredicto:** `APPROVED` para compatibilidad contractual; este reporte no revisa ni aprueba el WI en lugar del usuario.

## Hallazgos

- `createdAt: string | null` y la lectura histórica verificable coinciden con GH-INTEROP-1.2.
- La implementación compara inclusivamente la fecha original con `RepositoryBinding.createdAt`, conserva eventos normalizados sin crear Runs provisionales y solo reanuda cuando el binding está habilitado y el PR sigue abierto en el mismo HEAD.
- Los listados, detalles y bandejas filtran registros no elegibles; no cambian rutas ni shapes de respuesta públicas.
- Hace falta Contract Sync dirigido solo a Console para espejar las reglas nuevas de INTEROP-2.6. No se requiere sincronización a GitHub Integration o Sandbox ni cambio funcional de UI.

## Evidencia revisada

- `spec/contracts/github-integration-contract.md`: DTO de webhook y lectura histórica.
- `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`.
- `app/src/github-webhooks/github-webhooks.service.ts`.
- `app/src/analysis-runs/pull-request-metadata-backfill.job.handler.ts`.
- `app/src/analysis-runs/analysis-runs.repository.ts`.
- `app/src/functional-knowledge/functional-questions.repository.ts`.
- `git diff --check` pasó.

## Siguiente paso

Publicar `CS-CORE-20260927-003` dirigido a Console y completar `implementation-delivery`/`before-review`. Mantener WI-CORE-011 abierto para la revisión independiente humana.
