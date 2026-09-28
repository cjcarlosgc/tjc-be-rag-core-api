# Implementación — WI-CORE-015

**Estado del corte:** `W-IN_REVIEW`; pendiente de revisión independiente humana.

## Cambios

- Corregí el estado vigente en el encabezado y la regla de compatibilidad de `spec/contracts/system-contract.md`: `GH-INTEROP-1.2` y la fecha original están implementadas/cerradas localmente por `WI-CORE-014`, `WI-GH-007` y `WI-CORE-011`.
- Actualicé el encabezado de `spec/contracts/github-integration-contract.md` y aclaré que los cierres locales no implican despliegue/cutover.
- Retiré las referencias transitorias al proceso de envío de Contract Sync de los contratos vigentes.
- Alineé las referencias vigentes en `spec/constitution/{architecture,project-context,roadmap}.md`, `spec/features/013-pr-driven-analysis/{spec,plan}.md` y `spec/features/016-github-integration/{spec,plan}.md`.
- Registré `ST-CORE-022` / `WI-CORE-015` en Harness, conservando los snapshots anteriores sin cambios.
- Añadí el apunte actual a `CHANGELOG.md`; no reescribí entradas históricas.

No cambié la semántica ni versiones de `SYSTEM-2.5`, `INTEROP-2.6` o `GH-INTEROP-1.2`; tampoco cambié `app/`, Sandbox o infraestructura externa.

## Contratos fuente

SHA-256 finales, iguales en Core, Console y GitHub Integration:

- `spec/contracts/system-contract.md`: `879bce741d4cf5246dd30db62759cd3100804019e608e62a9028bc2e33fa487c`
- `spec/contracts/interoperability-contract.md`: `1f5cc04a7fc73388a49d1c1de4f79f873d0e95edec7db6e102b5f828f6a2f852` (sin cambios)
- `spec/contracts/github-integration-contract.md`: `1092ef36979f4fac7f17d6ee73c5b73723d0aaf1999b24d6098b095af5d62c45`

El `INTEROP-2.6` de Core es la fuente canónica. `CS-CORE-20260927-004`, `005` y `006` están resueltos en ambos consumidores. La última revisión fuente es `c96e9ad3c58a65914e234974f342b83415a50286`; Console y GitHub Integration comparan byte a byte contra ella.

## Verificación

Checks locales aprobados:

- `node harness/validate-work-items.mjs` — pasó (15 WIs).
- `node harness/validate-harness.mjs` — pasó.
- `node scripts/sdd-check.mjs` — pasó.
- `node harness/validate-completions.mjs` — pasó (8 WIs cerrados).
- `git diff --check` — pasó.
- `node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-015` — cero eventos entrantes relevantes pendientes.

No ejecuté lint, test ni build de la aplicación porque el WI no cambia código de producto. La revisión contractual está aprobada; la revisión independiente humana sigue pendiente.
