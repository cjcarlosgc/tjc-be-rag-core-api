# WI-CORE-037 — Contract Review post-implementación

**Rol:** contract-reviewer · perfil configurado GPT-6 Luna / High<br>
**Fecha:** 2026-10-11<br>
**Status:** APPROVED

## Findings

- La implementación transporta el `ProjectVersion.effectiveProjectRoot` congelado en ambos call sites PHP: Validation y Experiments. `SandboxExecutionService` solo serializa `projectRoot` cuando el request lo define; por ello PHP con raíz `.` envía exactamente `.` y las solicitudes legacy que no lo definen siguen omitiendo el campo.
- `NODE_TYPESCRIPT` conserva el comportamiento vigente: los call sites no le asignan `projectRoot`, y el servicio lo omite del JSON. La prueba del servicio fija expresamente esa omisión.
- Los request IDs no se recalculan ni incorporan la raíz: Validation conserva `sandboxGenerationRequestId(jobId, symbol.id)` y Experiments conserva `sandboxExperimentRequestId(jobId, strategy, repetition, attempt)`. El servicio sigue usando el mismo valor en el cuerpo `requestId` y en `Idempotency-Key`.
- Los artefactos de PHP anidado conservan el prefijo repo-relative (p. ej. `backend/tests/...`); la raíz solamente afecta el cálculo de ubicación/namespacing del test y el campo de transporte. Esto coincide con INTEROP-2.8 §7.2.
- No se añaden códigos, categorías ni temporalidad de errores en Core. La implementación no cambia los contratos canónicos ni el consumidor Sandbox.
- El PULL de `implementation-delivery` y `before-review` quedó registrado con `relevantPendingSyncIds: []`. El informe del implementer conserva una nota previa de gate pendiente, pero fue supersedida por el registro posterior del leader en `wi-core-037-contract-sync-checkpoints.md`.
- Diferenciación de alcance: los cambios de WI-CORE-036 están en persistencia/detección de raíces, migración, materialización y DTOs de Project/ProjectVersion. El delta de WI-CORE-037 es el transporte opcional `projectRoot`, su propagación desde la versión en esos dos call sites, la ubicación de tests PHP dentro de la raíz seleccionada y sus regresiones. Los cambios de formato/prettier en los archivos compartidos no alteran contrato.

## Blockers

Ninguno para el gate de Contract Review. Esta aprobación no equivale a revisión técnica independiente ni cierra el WI.

## filesAffected

- `app/src/sandbox/sandbox.types.ts`
- `app/src/sandbox/sandbox-execution.service.ts`
- `app/src/sandbox/sandbox-execution.service.spec.ts`
- `app/src/validation/analysis-run-validation-job.handler.ts`
- `app/src/validation/analysis-run-validation-job.handler.spec.ts`
- `app/src/experiments/experiment-job.handler.ts`
- `app/src/experiments/experiment-job.handler.spec.ts`
- `app/src/generation/php-test-path.ts`
- `app/src/generation/php-test-path.spec.ts`

## Evidence

- INTEROP-2.8 §7.2 en `spec/contracts/interoperability-contract.md`: DTO opcional, copia exacta de la raíz congelada, omisión legacy `.` en Sandbox, identidad de idempotencia con raíz normalizada y artefactos relativos a `repositoryRoot`.
- `git diff` del corte: adición de `projectRoot?: string`, serialización condicional, los dos call sites PHP y cálculo de rutas anidadas. No hay diff en contratos ni en el checkout Sandbox.
- Pruebas inspeccionadas: `SandboxExecutionService` verifica omisión Node, `Idempotency-Key` estable, root PHP y ruta repo-relative; Validation/Experiments verifican raíz anidada, request IDs deterministas y regresión TypeScript; `php-test-path.spec.ts` verifica prefijo `backend/`.
- `CS-CORE-20261011-002`: inbox Sandbox está `ACKNOWLEDGED` (`2026-10-11T10:07:24.536Z`) con evidencia en `wi-sandbox-001-contract-sync-acknowledgement.md`. SHA-256 del espejo `INTEROP-2.8`: `755c3357ca047ede9fb318a40a594cc68a63fc63f2b9f4c58af93c28f51a8d90`, idéntico en Core y Sandbox al verificar ambos archivos.
- El reporte de implementación adjunta evidencia de 156 pruebas focalizadas, 2,102 pruebas completas, lint, build y validaciones Harness/SDD; esta revisión contractual no vuelve a certificar esos gates técnicos.

## recommendedNextStep

Continuar con la revisión independiente del diff y evidencia técnica conforme al Harness; mantener `WI-CORE-037` en revisión hasta registrar su resultado. No se requiere nueva publicación/acuse de Contract Sync para este transporte ya importado y ACKNOWLEDGED.
