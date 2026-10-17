# WI-CORE-037 — Cierre

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Veredicto

`WI-CORE-037` queda cerrado como `W-DONE`. El usuario aprobó el alcance; la implementación terminó y recibió aprobación independiente del reviewer y aprobación contractual post-implementación, ambas sin bloqueantes. El Modo fuera de casa estaba activo, por lo que la revisión independiente delegada fue válida para este WI.

El corte transmite `effectiveProjectRoot` a ejecuciones PHP de Validation y Experiments, conserva request IDs/idempotencia y artefactos repo-relative, y mantiene omisión del campo en Node y solicitudes legacy. No modifica el Sandbox ni implementa la nota de drenaje/reconciliación de despliegue, que permanece fuera de alcance.

## Evidencia de cierre

- Implementación: `wi-core-037-implementation.md`; 156 pruebas focalizadas y suite completa de 2.102 aprobadas / 104 omitidas, lint y build aprobados.
- Revisión independiente: `wi-core-037-independent-review.md` → `APPROVED`, sin hallazgos ni bloqueantes; el reviewer repitió las 156 pruebas focalizadas.
- Revisión contractual: `wi-core-037-contract-review-post-implementation.md` → `APPROVED`; verificó el ACK Sandbox para `CS-CORE-20261011-002` y el SHA-256 coincidente de INTEROP-2.8 (`755c3357ca047ede9fb318a40a594cc68a63fc63f2b9f4c58af93c28f51a8d90`).
- Contract Sync `before-done`: `wi-core-037-contract-sync-checkpoints.md`; `relevantPendingSyncIds: []`, nueve eventos resueltos y dos históricos clasificados `NOT_RELEVANT` para este WI.
- El WI usó 1 de 2 ciclos permitidos; no hay excepción de ciclo.
- Validaciones finales ejecutadas por el leader: `node scripts/sdd-check.mjs`, `node harness/validate-harness.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-completions.mjs` y `git diff --check`; todas pasaron.
- Se documenta el resultado del PULL, ambos veredictos y los gates en `harness/state.json`.

No quedan decisiones bloqueantes aplicables: `DEC-PHP-ROOT-001` permanece pendiente solo para el caso multi-manifiesto, fuera del alcance aprobado. El cierre no autoriza push, PR ni cambios externos.
