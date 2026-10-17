# WI-CORE-037 — Implementación

Modelo: implementer-high · configurado GPT-6 Luna · atendido unknown · esfuerzo high

## Resultado

Implementación Core lista para revisión independiente. El alcance transmite `ProjectVersion.effectiveProjectRoot` en ejecuciones PHP de Validation y Experiments. Los request IDs deterministas no cambian; solicitudes legacy/Node omiten `projectRoot`. Para PHP anidado, la ubicación de test se calcula dentro de la raíz del subproyecto y el artefacto conserva el prefijo repo-relative al enviarse.

No se modificaron contratos, Sandbox, despliegues ni la nota operativa de drenaje/reconciliación.

## Archivos

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

- Pruebas focalizadas: 4 archivos, 156 pruebas aprobadas.
- Suite completa: 138 archivos aprobados, 6 omitidos; 2,102 pruebas aprobadas, 104 omitidas.
- `pnpm lint`: aprobado.
- `pnpm build`: aprobado.
- `node scripts/sdd-check.mjs`: aprobado.
- `node harness/validate-work-items.mjs`: aprobado.
- `node harness/validate-harness.mjs`: aprobado.
- `node harness/validate-completions.mjs`: aprobado.
- `git diff --check`: aprobado.

## Gate pendiente

`node harness/contract-sync.mjs check --checkpoint implementation-delivery --work-item WI-CORE-037` informa `CS-20260920-001` y `CS-20260921-003` como pendientes relevantes, aunque ambos están ACKNOWLEDGED. Son eventos Console sobre lifecycle de bindings/Projects y login/despliegue, sin relación con WI-CORE-037. El implementer notificó al leader; falta su disposición Harness (p. ej., revisión `NOT_RELEVANT` con digest y evidencia) antes de que el PULL delivery pueda pasar. No se modificó el registro Harness para forzar el gate.

## Siguiente paso

El leader resuelve Contract Sync y registra el PULL `implementation-delivery`; luego presenta el corte para Contract Review y revisión independiente. No declarar `W-DONE` desde esta entrega.
