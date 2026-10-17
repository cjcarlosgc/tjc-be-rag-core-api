# Cierre local — WI-CORE-014

**Fecha:** 2026-09-27
**WI/ST/HU:** WI-CORE-014 / ST-CORE-021 / HU02, HU14
**Commit canónico:** `40a93bead66e7eac15f515065ec204e3526b78df` (`docs(core): define original pull request dates`)
**Contract Sync:** `CS-CORE-20260927-002`, publicado a GitHub Integration y Console con estado `C-PENDING`.

## Resultado

- Core publica `GH-INTEROP-1.2` como fuente canónica para la fecha original de creación del PR en webhook y recuperación histórica.
- Las fechas ausentes, inválidas o ambiguas no se sustituyen por `receivedAt`; el webhook las expresa como `null`, y la lectura histórica responde `UNVERIFIABLE` sin valor parcial. Core mantiene ocultos los Runs afectados y reintenta su clasificación durablemente.
- El delta no modifica `SYSTEM-2.5`, `INTEROP-2.6`, APIs públicas Core, UI, Sandbox ni configuración externa.
- El Contract Sync solicita a los consumidores importar byte por byte el contrato completo y reconocer su acción en WIs propios. Sus ACKs, implementación y disponibilidad no se infieren del cierre de este WI.
- Git local permanece en `feature/jean`; no se hizo push ni PR.

## Evidencia y gates

- `sdd-check`, `validate-work-items`, `validate-harness`, `validate-completions` y `git diff --check`: PASS.
- No se ejecutaron lint, pruebas ni build de aplicación porque el corte solo modificó SDD y Harness.
- Revisión contractual: `wi-core-014-contract-review.md` (APPROVED).
- Revisión independiente del usuario: `wi-core-014-user-review-final.md` (APPROVED).
- Los cuatro checkpoints Contract Sync quedaron en orden y sin pendientes relevantes: `wi-core-014-contract-sync-checkpoints.md` y `state.json`.
- Los diez gates aplicables están `G-PASSED`, cada uno con evidencia en `state.json`.

Siguiente secuencia: GitHub Integration importa y reconoce `CS-CORE-20260927-002`; luego implementa WI-GH-007 y comunica su entrega. Core-011 y Console-008 permanecen detrás de esas dependencias.
