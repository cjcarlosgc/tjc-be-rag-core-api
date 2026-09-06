# observability — Tareas

- [x] Logger estructurado (Nest `Logger` con contexto por clase, sin literales dispersos).
- [x] Correlation middleware (`x-correlation-id`, propagado a logs y al envelope de error).
- [x] Stage timings (`SandboxExecutionResult.stageDurations`, capturado desde `SandboxExecutionResultResponse` y logueado por `SandboxExecutionService`; `ExperimentRepetition` también captura `generationDurationMs`/`executionDurationMs`/`totalDurationMs` por repetición).
- [x] redaction tests (`sandbox-execution.service.spec.ts`: confirma que un fallo HTTP no filtra la URL firmada del `EphemeralDownloadRef` en el mensaje de error).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
