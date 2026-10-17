# WI-CORE-037 — Revisión técnica independiente

Modelo: reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

**Fecha:** 2026-10-11<br>
**Veredicto:** `APPROVED`

## Findings

Ninguno. No se encontró defecto bloqueante ni desviación del alcance en los nueve archivos fuente/test declarados por la implementación.

## Blockers

Ninguno para el gate de revisión técnica independiente. La nota de drenaje/reconciliación de ejecuciones durante un despliegue queda fuera de este WI y no se evaluó como requisito de implementación.

## Archivos afectados/revisados

- `app/src/sandbox/sandbox.types.ts`
- `app/src/sandbox/sandbox-execution.service.ts`
- `app/src/sandbox/sandbox-execution.service.spec.ts`
- `app/src/validation/analysis-run-validation-job.handler.ts`
- `app/src/validation/analysis-run-validation-job.handler.spec.ts`
- `app/src/experiments/experiment-job.handler.ts`
- `app/src/experiments/experiment-job.handler.spec.ts`
- `app/src/generation/php-test-path.ts`
- `app/src/generation/php-test-path.spec.ts`

## Evidencia

- Transporte: `SandboxExecutionRequest.projectRoot` es opcional; el request HTTP conserva el mismo `requestId`, y el campo solo se agrega al body cuando fue suministrado (`sandbox.types.ts:91-92`, `sandbox-execution.service.ts:124-141`). La omisión legacy conserva el body anterior.
- Validation: obtiene y propaga `version.effectiveProjectRoot`, lo usa al calcular el path de pruebas y solo agrega `projectRoot` al request para PHP; mantiene `sandboxGenerationRequestId(jobId, symbol.id)` (`analysis-run-validation-job.handler.ts:267-301, 477-495`).
- Experiments: el contexto se forma desde `version.effectiveProjectRoot`; se conserva `sandboxExperimentRequestId(...)` y la raíz solo se añade para PHP (`experiment-job.handler.ts:437-450, 938-964`).
- Paths: `phpTestLocation` calcula namespace/ruta dentro del subproyecto y prefija el artefacto y la comprobación de colisión con `projectRoot`, manteniendo paths POSIX relativos al repositorio (`php-test-path.ts:36-77`).
- Compatibilidad/regresiones: las pruebas cubren omisión de `projectRoot` en la ruta NODE/Jest, envío PHP con key de idempotencia sin cambios, root anidado y artefactos prefijados en Validation y Experiments, más la regresión de raíz `.`. Los paths de artefactos mantienen su prefijo repo-relative.
- Manejo de respuesta/error: el cambio funcional del cliente de Sandbox se limita al campo opcional del body; polling, mapeo de resultado, autenticación/correlación y errores pre/post-aceptación conservan el flujo existente. Las pruebas focalizadas cubren los cuatro archivos de tests.
- Seguridad: no se añadieron comandos, credenciales ni logging del nuevo valor. La raíz proviene de la `ProjectVersion` congelada y el Sandbox conserva la responsabilidad contractual de validarla bajo el snapshot antes de su uso.
- Checkpoint PULL ejecutado en modo no registrante: `node harness/contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-037` → `relevantPendingSyncIds: []`; nueve eventos resueltos y los dos eventos antiguos excluidos para este WI con disposición `NOT_RELEVANT`.
- Revisión contractual previa `APPROVED` en `wi-core-037-contract-review.md`; implementación reporta suite completa (2,102 pruebas aprobadas), lint y build aprobados.
- Verificación independiente ejecutada: `pnpm --dir app exec vitest run src/sandbox/sandbox-execution.service.spec.ts src/validation/analysis-run-validation-job.handler.spec.ts src/experiments/experiment-job.handler.spec.ts src/generation/php-test-path.spec.ts` → 4 archivos, 156 pruebas aprobadas.
- `git diff --check`, `node harness/validate-harness.mjs`, `node harness/validate-work-items.mjs` y `node harness/validate-completions.mjs` → aprobados.

## Siguiente paso recomendado

Registrar este veredicto como gate de revisión independiente. No cerrar automáticamente el WI: el leader debe completar los gates de Contract Sync/cierre que faltan, revisar la evidencia final y actualizar el Harness conforme al flujo.

**status:** `APPROVED`<br>
**findings:** ninguno<br>
**blockers:** ninguno para la revisión técnica<br>
**filesAffected:** los nueve archivos enumerados arriba; este reporte es el único archivo creado por esta revisión<br>
**recommendedNextStep:** registrar el gate `APPROVED` y que el leader continúe con los gates restantes, sin atribuir el resguardo operativo fuera de alcance al implementer.
