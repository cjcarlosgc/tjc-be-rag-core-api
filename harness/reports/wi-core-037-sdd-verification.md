# WI-CORE-037 — Verificación SDD

Modelo: sdd-analyst · configurado gpt-6-luna · atendido unknown · esfuerzo high

**Resultado revisado:** `SPEC_VERIFIED`. El alcance, sus decisiones y sus dependencias están suficientemente definidos. La aprobación humana es el gate siguiente (`W-AWAITING_APPROVAL`) y sigue pendiente antes de pasar a `W-IN_PROGRESS`; no forma parte del gate SDD. Este reporte recomienda actualizar el estado correspondiente, pero no modifica `harness/state.json`.

## Reconciliación con el handoff anterior

La evaluación inicial marcó `SPEC_VERIFICATION_INCOMPLETE` porque en ese momento no tenía evidencia accesible desde este checkout sobre Sandbox y el Contract Sync. Esa conclusión queda supersedida por la verificación posterior del Contract Reviewer y la reconciliación del líder: WI-SANDBOX-001 está `DONE` con gates/revisiones aprobados; `CS-CORE-20261011-002` está importado y `ACKNOWLEDGED` en el inbox Sandbox con hash INTEROP-2.8 coincidente (`755c3357ca047ede9fb318a40a594cc68a63fc63f2b9f4c58af93c28f51a8d90`). El Contract Reviewer emitió `APPROVED` sin blockers.

La lectura inicial de `C-PENDING` en el outbox productor no acreditaba ausencia de ACK: el estado de recepción vive en el inbox consumidor. La falta del objeto `1139abc` en el Git local de Core tampoco invalida la evidencia directa posterior, localizada en el checkout Sandbox y citada por el Contract Reviewer. La tarjeta de bloqueos anterior que decía `CHANGES_REQUESTED` también está supersedida por ese veredicto y esa evidencia.

## Hallazgos

- WI-CORE-037 está seleccionado (`W-SELECTED`), prioridad P1, sprint `PHP compatibility cross`, vinculado a HU10/HU11/HU12 y ST-CORE-044. Sus cinco criterios de aceptación cubren transporte del root congelado, compatibilidad legacy/idempotencia, ejecución PHP desde el cwd del subproyecto, artefactos repo-relative y gates Sandbox. La tarea dueña sigue `T-READY`.
- INTEROP-2.8 §6.1/§6.2 fija la raíz activa y la raíz congelada por snapshot, con paths públicos repo-relative. §7.2 define `projectRoot` opcional, normalización a `.`, validación bajo `repositoryRoot`, cwd Composer/PHPUnit en `projectRoot`, artefactos repo-relative e inclusión del root normalizado en identidad/idempotencia. No queda una contradicción local que impida verificar el alcance Core.
- Feature 019 asigna este corte a ST-CORE-044 y exige Contract Sync resuelto antes de implementar el transporte. Feature 008 exige snapshot y `effectiveProjectRoot` congelados para la comparación; async-jobs exige identidad hija estable, reintentos idempotentes y estados durables. Ninguna de estas especificaciones autoriza activar el campo antes del soporte consumidor.
- WI-CORE-036 consta `W-DONE`/cerrado en el Harness, con reporte de cierre e implementación y evidencia de revisión/gates. La dependencia local puede considerarse satisfecha; no se usa su cierre para inferir soporte Sandbox.
- `DEC-PHP-ROOT-001` está `PENDING`, pero su `Blocks` limita el bloqueo al subcaso de dos o más `composer.json` en feature 019. No bloquea WI-CORE-037, que transporta la raíz ya resuelta y no cambia esa política. Registrar como decisión aplicable no bloqueante si se actualiza el gate de decisiones.
- El reporte de Contract Review confirma que el consumidor importa INTEROP-2.8 y aceptó el alcance de su WI local. Para la etapa `start`, `C-ACKNOWLEDGED` satisface la dependencia; el estado no afirma que Sandbox haya actualizado su baseline global ni se requiere que lo haga en este corte. `C-RESOLVED` seguirá siendo un gate de entrega/cierre según el protocolo.

## Aprobaciones y bloqueos

- No hay blockers para `SPEC_VERIFIED`. El gate de aprobación humana de alcance permanece pendiente (`approved=false`); corresponde a la transición posterior a `W-AWAITING_APPROVAL` y debe pasar antes de implementar.
- La revisión contractual del WI Core está `APPROVED`. La aceptación Sandbox y el ACK de `CS-CORE-20261011-002` están confirmados por evidencia directa revisada; no bloquean el gate SDD ni el inicio después de aprobación humana.
- Contract Sync tiene impacto (`contractImpact=true`, `publishesContract=true`). El contrato canónico Core no requiere una nueva edición para este análisis. La implementación debe enviar el campo solo una vez que Core complete y verifique WI-CORE-037; los checkpoints posteriores deberán exigir resolución de cualquier obligación relevante.
- `DEC-PHP-ROOT-001` es aplicable y no bloqueante para el corte de candidato único.

## Evidencia consultada

- `spec/README.md`; `spec/backlog.md`.
- `spec/contracts/interoperability-contract.md` §§1, 3, 6.1, 6.2 y 7.2.
- `spec/features/019-project-root-detection/{spec,plan,tasks}.md`.
- `spec/features/008-experimental-comparison/{spec,plan,tasks}.md`.
- `spec/transversal/async-jobs/spec.md`.
- `harness/work-items.json` (WI-CORE-036/037 y criterios); `harness/state.json` (WI activo y gates); `harness/contract-sync/outbox/CS-CORE-20261011-002.yaml`.
- `harness/reports/wi-core-036-{implementation,closure}.md`; `harness/reports/wi-core-037-contract-review.md`; `harness/reports/wi-core-037-pretask-reconciliation.md`; `harness/reports/morning-card-cross-contract-blockers-2026-10-11.md` (supersedido para el estado Sandbox/Contract Review).
- Evidencia directa del consumidor citada en Contract Review: WI-SANDBOX-001 DONE, gates/revisiones aprobados, inbox `CS-CORE-20261011-002` ACKNOWLEDGED y hash coincidente.
- Verificación ejecutada: `node harness/validate-harness.mjs` → `Harness V3 validation passed`.
- Verificación de disponibilidad local: `git cat-file -t 1139abc` → objeto no encontrado.

## Archivos afectados

- Creado únicamente: `harness/reports/wi-core-037-sdd-verification.md`.
- Sin cambios a `app/`, contratos, `harness/state.json` ni work items.

## Siguiente paso recomendado

Registrar el gate SDD como verificado y avanzar a `W-AWAITING_APPROVAL`; solicitar la aprobación humana de alcance pendiente. Tras esa aprobación, pasar a implementación delegada. Mantener omitido `projectRoot` en los requests hasta completar y verificar WI-CORE-037.

**status:** `SPEC_VERIFIED`<br>
**findings:** alcance Core legible y acotado; WI-CORE-036 satisfecha; Sandbox WI-SANDBOX-001 DONE y ACK exacto confirmado; contract review APPROVED; DEC-PHP-ROOT-001 aplicable pero no bloqueante.<br>
**blockers:** ninguno para SDD; aprobación humana de alcance pendiente como gate separado antes de `W-IN_PROGRESS`.<br>
**filesAffected:** `harness/reports/wi-core-037-sdd-verification.md`.<br>
**evidence:** Harness validator PASS; revisión contractual `APPROVED`; reconciliación del líder con evidencia directa de WI-SANDBOX-001 DONE, `CS-CORE-20261011-002` importado/ACKNOWLEDGED y SHA coincidente; `approved=false`.<br>
**recommendedNextStep:** registrar `SPEC_VERIFIED`, mover al gate `W-AWAITING_APPROVAL` y esperar aprobación humana antes de iniciar implementación.<br>
**executedBy:** `sdd-analyst`.
