# 006-validation-orchestration — Tareas

- [x] Cliente HTTP Sandbox con timeouts/correlationId (`SandboxExecutionService`: `AbortController` + `SANDBOX_REQUEST_TIMEOUT_MS`, header `x-correlation-id` propagado en POST/GET, `Idempotency-Key` = `requestId`).
- [x] Incorporar `SANDBOX_SERVICE_TOKEN` validado condicionalmente con `SANDBOX_URL` y enviar `Authorization: Bearer` en POST/GET de `/executions`; cubrir ausencia, token inválido y redacción en logs (el token nunca se loguea; solo `Bearer <token>` sale por el header HTTP).
- [x] Reemplazar el UUID aleatorio por UUID v5 estable según unidad lógica (`generation:{jobId}:{targetId}`, `experiment:{jobId}:{strategy}:{repetition}`, `manual-retry:{retryJobId}:{targetId}`), usando el mismo valor en `requestId` e `Idempotency-Key` durante retries.
- [ ] Verificar integración real Core↔Sandbox protegida: aceptación, polling, replay equivalente, conflicto y rechazo 401/403. Pendiente de un Sandbox desplegado real; no es código de Core.
- [x] Construir `EphemeralDownloadRef` con signed URL corta, SHA-256 y tamaño sin persistirla ni loguearla completa (`buildSnapshotRef`/`buildArtifactRef`: `presignGet` + `sha256`/`sizeBytes` calculados en memoria; la URL no se persiste en DB ni aparece en logs).
- [x] Mapeo result/failureType (`mapSandboxResult`: COMPLETED+passed→VALID/NONE; COMPLETED+!passed→INVALID/COMPILATION|TEST_RUNTIME|TEST_ASSERTION; FAILED→failure.category; TIMED_OUT→INFRASTRUCTURE).
- [ ] Batch validation: **parcial en V1** — cada target se valida individualmente (`scope: 'TARGET'`) inmediatamente después de su CREATE/MERGE, en vez de una fase `BATCH_VALIDATING` separada al final con el conjunto completo de artefactos del run. Cubre correctamente "solo validar artefactos creados/modificados del run actual" pero no implementa la validación batch final adicional que la spec menciona como posible refinamiento.
- [x] Resiliencia a Sandbox unavailable (`SandboxUnavailableError`; sin `SANDBOX_URL` configurado o fallo de red/timeout/máx. intentos de polling → el target correspondiente se marca `FAILED`/`INFRASTRUCTURE`, el run continúa con los demás targets).
- [x] Status y results endpoints (`GET /test-runs/:id`, `GET /test-runs/:id/results`).
- [x] Persistir en Core el resultado normalizado devuelto por Sandbox (`TargetRunResult`: compiled/executed/passed/valid/failureType/errorSummary).

## Calidad

- [x] Agregar/actualizar pruebas (`sandbox-execution.service.spec.ts`: upload de artefactos, polling hasta estado terminal, timeout de red, máximo de intentos de polling, headers de correlación/idempotencia).
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima (`Logger.warn` en fallos de comunicación con el Sandbox).
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/` (`005-006-007-generation-pipeline.md`).

## Limitación real (no resuelta, no un simulacro)

**No existe verificación end-to-end contra un Sandbox real.** El cliente HTTP cubre DTOs, correlación, polling, mapeo, Bearer e identidad idempotente estable de `INTEROP-1.5` (SDD 1.15) con mocks/fakes, pero nunca se probó contra el servicio real desplegado — eso es validación cross-repo. `evidenceIds` en `ValidationResponse` queda siempre `[]`: la captura/almacenamiento de evidencia (stdout/stderr) de `ExecutionEvidenceFact` no se implementó en este corte.
