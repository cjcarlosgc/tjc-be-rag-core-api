# WI-CORE-030 — revisión de contrato: valores de ExperimentStatusResponse.failureCode (2026-10-09)

Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

## Veredicto

APPROVED. Contract Sync informativo, aditivo, breaking=false, target console. Sin bump de versión.

## Verificación en código

Únicos valores emitidos en `failureCode` de experimentos (ambos vía `ExperimentRunsRepository.markFailed`):

- `EXPERIMENT_FAILED` (`app/src/experiments/experiment-job.handler.ts`, catch de `handle()`): un error durante la ejecución marca el run FAILED con el mensaje del error. `RescheduleJobError` no cuenta como fallo.
- `EXPERIMENT_WORKER_LOST` (`onExhausted`, misma clase): la cola agotó intentos tras la muerte del worker; cierra repeticiones huérfanas y marca FAILED solo si el run no estaba ya COMPLETED/FAILED (un run ya FAILED conserva `EXPERIMENT_FAILED`).
- Reanudación: `experiment-runs.repository.ts` limpia `failureCode`/`failureMessage` al reiniciar y al completar.

No hay otros códigos. Las demás copias de `failureCode` del INTEROP (RetrievalComparisonStatusResponse ~1080, SandboxExecutionStatusResponse ~1284, facts de sandbox ~1188) no son de experimentos y no se tocaron. Los `ErrorCode.EXPERIMENT_*` (NOT_FOUND, NOT_FINISHED) son códigos de error HTTP, no failureCode.

## Texto añadido (INTEROP, tras ExperimentStatusResponse)

```
// Nota informativa sobre ExperimentStatusResponse.failureCode: el campo sigue siendo `string | null` abierto; los consumidores deben tolerar valores desconocidos. Valores que Core emite hoy cuando status = FAILED: `EXPERIMENT_FAILED` (el handler capturó un error durante la ejecución y marcó el run) y `EXPERIMENT_WORKER_LOST` (la cola agotó los intentos tras la muerte del worker y cerró el run). Un run FAILED puede reanudarse; si completa, vuelve a COMPLETED y failureCode/failureMessage se limpian a null.
```

## Texto propuesto para el evento CS (no publicado)

- target: console
- breaking: false
- changed: Se documenta en INTEROP que ExperimentStatusResponse.failureCode (string | null, abierto, sin cambio de tipo) toma hoy los valores EXPERIMENT_FAILED (error capturado durante la ejecución) y EXPERIMENT_WORKER_LOST (worker caído y cola con intentos agotados). Un run FAILED puede reanudarse y, al completar, failureCode/failureMessage vuelven a null.
- requiredAction: Console debe tolerar cualquier valor desconocido de failureCode y mostrar un mensaje claro para los dos conocidos (p. ej. EXPERIMENT_FAILED: "El experimento falló durante la ejecución"; EXPERIMENT_WORKER_LOST: "Se interrumpió el procesamiento del experimento; puede reanudarse"), usando failureMessage como detalle. Sin cambio de tipos ni de rutas.
