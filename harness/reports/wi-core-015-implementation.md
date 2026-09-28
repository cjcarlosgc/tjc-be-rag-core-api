# Implementación — WI-CORE-015

**Estado del corte:** en progreso de revisión; no cerrado.

## Cambios

- Corregí el estado vigente en el encabezado y la regla de compatibilidad de `spec/contracts/system-contract.md`: `GH-INTEROP-1.2` y la fecha original están implementadas/cerradas localmente por `WI-CORE-014`, `WI-GH-007` y `WI-CORE-011`.
- Actualicé el encabezado de `spec/contracts/github-integration-contract.md` y aclaré que los cierres locales no implican despliegue/cutover.
- Alineé las referencias vigentes en `spec/constitution/{architecture,project-context,roadmap}.md`, `spec/features/013-pr-driven-analysis/{spec,plan}.md` y `spec/features/016-github-integration/{spec,plan}.md`.
- Registré `ST-CORE-022` / `WI-CORE-015` en Harness, conservando los snapshots anteriores sin cambios.
- Añadí el apunte actual a `CHANGELOG.md`; no reescribí entradas históricas.

No cambié la semántica ni versiones de `SYSTEM-2.5`, `INTEROP-2.6` o `GH-INTEROP-1.2`; tampoco cambié `app/`, Sandbox o infraestructura externa.

## Contratos fuente

SHA-256 en el working tree al completar las correcciones narrativas:

- `spec/contracts/system-contract.md`: `e0423375f15d0e4c29feac96475292e530902f60742fbd07238a50b3f9f9e13d`
- `spec/contracts/interoperability-contract.md`: `1f5cc04a7fc73388a49d1c1de4f79f873d0e95edec7db6e102b5f828f6a2f852` (sin cambios)
- `spec/contracts/github-integration-contract.md`: `8a80c056359af74dc8b3b704f47efb232eaafb250bd4efb1d923450435a9e9f9`

El `INTEROP-2.6` de Core/Console es la fuente canónica; GitHub Integration requiere sincronizar su espejo desde `INTEROP-2.5`. `CS-CORE-20260927-004` se publicó a ambos consumidores con `sourceRevision: 606006b44c23c0515c73dc21518102bb49edcb8c`, el commit que contiene estas fuentes.

## Verificación

Checks locales aprobados:

- `node harness/validate-work-items.mjs` — pasó (15 WIs).
- `node harness/validate-harness.mjs` — pasó.
- `node scripts/sdd-check.mjs` — pasó.
- `node harness/validate-completions.mjs` — pasó (8 WIs cerrados).
- `git diff --check` — pasó.

No ejecuté lint, test ni build de la aplicación porque el WI no cambia código de producto. `before-review` y la revisión contractual se registran por separado; la importación de los consumidores aún debe verificarse.
