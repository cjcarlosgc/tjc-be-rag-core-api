# WI-CORE-007 — Verificación de suficiencia SDD
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura sobre `app/`; se añadió «Detalle técnico verificado (WI-CORE-007)» a `spec/features/008-experimental-comparison/plan.md`.

## Veredicto: SPEC_VERIFIED (sin bloqueos; una confirmación de alcance recomendada)

HU12 y HU17 están en HU01–HU18; `ST-CORE-007` existe en `008/tasks.md:3`; componente CORE; sin `caseIds`; `dependsOn WI-CORE-001` cerrado. `contractSyncReview` ya clasifica CS-20260920-001 y CS-20260921-003 como NOT_RELEVANT.

## decisionGate: PASS

No hay decisión `PENDING`/`PROPOSED` con `Blocks` que alcance este WI (`DEC-INF-001`, `DEC-VAL-001`, `DEC-RAG-001` no lo tocan). Registrar bloqueantes `[]`; no bloqueantes `DEC-EXP-FK-001`, `DEC-EXP-003`, `DEC-EXP-004`, `DEC-EXP-002`, `DEC-IDEMP-001` (heredados de la feature, sin efecto aquí). No se registra ninguna decisión nueva: todo lo diseñado cae en el detalle técnico del propio WI.

## Alcance y aprobación del usuario

`harness/reports/smart-v3-scope-approval.md` cubre literalmente `WI-CORE-017` a `027` y no nombra 007. Funcionalmente sí cabe: el comportamiento ya consta en `plan.md:33` («Diseño técnico SMART V3»), en `experimental-metrics/plan.md:23` y en INTEROP-2.7 §6.16 (`sandbox.facts` con `failureStage/Category/Code/Message` saneado), que la aprobación cubre («comportamientos y contratos descritos en SYSTEM-2.6 e INTEROP-2.7»); no cambia contrato y alimenta a `WI-CORE-027`. Recomendación: una confirmación de una línea del usuario al presentar el alcance (el literal no lista 007; precedente `WI-CORE-030`), no bloqueante para `SPEC_VERIFIED`.

## Hallazgos

1. **Columna inexistente, mapeo seguro.** `app/prisma/schema.prisma:826-872` (`ExperimentRepetition`, `@@map experiment_repetitions`) no tiene `failure`. `ExperimentsService` mapea la respuesta campo a campo (`experiments.service.ts:~283-300`), así que una columna nueva no se filtra al DTO.
2. **Dato disponible, hoy descartado.** `SandboxExecutionResult.failure: SandboxFailureFact | null` (`sandbox.types.ts:40-55`); `SandboxExecutionService` solo lo registra en log (`sandbox-execution.service.ts:218-226`) y `mapSandboxResult` conserva solo `category` y `message` en `failureType`/`errorSummary` (`map-sandbox-result.ts`). `runAttempt` descarta `sandboxResult.failure` (`experiment-job.handler.ts:~782-805`).
3. **Punto único de escritura.** `recordRepetition` → `updateRepetitionById` (`experiment-job.handler.ts:1314-1411`, `experiment-runs.repository.ts:286-308`) ya hace `updateMany where state RUNNING` (guarda H3): `failure` se añade a esa misma escritura y hereda idempotencia y guarda sin código nuevo. `closeInterruptedRepetition` (`experiment-runs.repository.ts:233-255`, usado por `closeInterruptedAttempt` y `onExhausted`) no cambia y deja `failure` `NULL`.
4. **No existe helper de saneado reutilizable.** Búsqueda en `app/src`: solo hay redacción local de la URL firmada (`sandbox-execution.service.spec.ts:218`) y mensajes constantes en `retrieval-comparison-job.handler.ts`. Hay que crear `sanitizeFailureMessage` (puro, `app/src/common/`). Punto de coordinación con `WI-CORE-027`.
5. **RLS.** La tabla ya tiene RLS; una columna nueva no necesita RLS propio (la regla y `rls-guard.spec.ts` aplican a tablas nuevas). El patrón de migraciones recientes (`20261009170000_analysis_run_check_published_at`) es: encabezado con alcance, «sin backfill» y rollback manual, `ALTER TABLE ... ADD COLUMN` nullable. Nombre propuesto `20261009180000_experiment_repetition_failure`.
6. **Texto obsoleto en tasks.** `008/tasks.md:3` (ST-CORE-007) dice «si corresponde, resultados por target … actualizar contrato»; el WI y `plan.md:33` fijan solo experimentos, `TargetRunResult` intacto y sin cambio de contrato. Alinear el texto de la tarea al cerrar el WI.
7. **`TIMED_OUT` sin hecho.** El Sandbox puede devolver `TIMED_OUT` sin `failure`; se persiste `NULL` (el discriminador ya es `sandboxTimedOut`). No se sintetiza un hecho.

## Impacto contractual

`contractImpact=false`, `publishesContract=false` confirmados: INTEROP §6.5 no cambia (`ExperimentRepetitionResponse` sin campo nuevo) y §6.16 ya declara los hechos `failure*` saneados (`interoperability-contract.md:1192`). No hay Contract Sync que emitir ni `contract-reviewer` obligatorio antes de implementar. Los cuatro checkpoints del AC son los de cierre del harness para consumir eventos ajenos, ya revisados NOT_RELEVANT.

## Riesgos

- Saneado incompleto: un patrón de secreto no cubierto llega a la evidencia. Mitigación: lista de patrones cerrada y probada, redactar antes de truncar, límite de 500 caracteres, y revisión humana de los patrones.
- Divergencia con `WI-CORE-027` si este también sanea con otra regla: usar el mismo helper.
- Nuevo campo en filas leídas por `findRepetitions`: riesgo de fuga futura por un spread; cubrir con prueba de que el DTO no tiene `failure`.
- Prisma JSON null: no escribir `null` explícito; omitir la clave (la columna queda `NULL`).

## Cortes propuestos

- **A** — migración + schema + regeneración del cliente + helper `sanitizeFailureMessage` con su spec (sin tocar el handler). Revisión humana de migración y patrones.
- **B** — `ExperimentRepetitionInput.failure` en repositorio + escritura en `updateRepetitionById` con spec; handler que construye el hecho validado y saneado en `runAttempt` con specs (intentos 1 y 2, timeout, excepción, secretos, guarda RUNNING) y prueba del DTO sin `failure`.
- Cierre: lint, test, build y `node harness/validate-harness.mjs`; presentar diff y evidencia al Human Reviewer. Un corte único también es razonable por su tamaño.

## Handoff

`status`: SPEC_VERIFIED · `blockers`: ninguno · `filesAffected` (futuros): `app/prisma/schema.prisma`, nueva migración, `app/src/common/` (helper), `app/src/experiments/experiment-job.handler.ts`, `app/src/experiments/persistence/experiment-runs.repository.ts` y sus specs · `recommendedNextStep`: el leader registra el `decisionGate` en `state.json`, pide la confirmación de alcance de una línea y pasa a `SPEC_VERIFIED`.

## Nota del leader (2026-10-09)
Aprobación de alcance: la confirmación de una línea del usuario sobre `WI-CORE-007` (no está listado literalmente en `smart-v3-scope-approval.md`) está **PENDIENTE**; la solicita el agente principal. El leader implementa hasta `W-IN_REVIEW` y no cierra `W-DONE` sin esa confirmación y el veredicto humano de la revisión. `approved=true` en el estado refleja la instrucción del agente principal de proceder, no la confirmación del usuario.

## Actualización del leader (2026-10-09, tras la confirmación del usuario)
El usuario confirmó en chat que `WI-CORE-007` entra en el alcance aprobado (`smart-v3-scope-approval.md`): la confirmación de alcance pendiente queda **resuelta**. La revisión independiente la delegó explícitamente el usuario a un agente `reviewer` (ciclo 1: CHANGES_REQUESTED; ver `wi-core-007-independent-review.md`).
