# WI-CORE-037 — Contract Review

**Modelo:** contract-reviewer · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `high`<br>
**Fecha:** 2026-10-11<br>
**Veredicto:** APPROVED

## Findings

- No se encontraron contradicciones bloqueantes entre INTEROP-2.8 y los criterios contractuales de WI-CORE-037. La raíz a enviar es la `ProjectVersion.effectiveProjectRoot` inmutable, no el `Project.projectRoot` activo ni una raíz detectada de nuevo en el momento de ejecutar.
- La omisión de `projectRoot` conserva el comportamiento legacy como `.`. La identidad `requestId` existente se mantiene estable para el mismo trabajo; el Sandbox normaliza la raíz en la huella del request, por lo que reusar una key con otra raíz produce conflicto de idempotencia en vez de ejecutar otro subproyecto bajo la misma identidad.
- Los paths de artefactos permanecen relativos a `repositoryRoot` y con prefijo del subproyecto. El runner puede reexpresar una ruta validada para invocar PHPUnit desde su cwd, pero no debe persistir ni devolver esa forma relativa al cwd como identidad o evidencia.
- La validación del Sandbox rechaza raíces absolutas, no normalizadas, inexistentes, con traversal o con escape por symlink antes de ejecutar; fallos posteriores a `202` quedan como hecho terminal `CONFIGURATION/INVALID_PROJECT_ROOT`. También se prueba el escape por symlink en artefactos. `NODE_TYPESCRIPT` conserva `projectRoot = .` y sus reglas previas.
- WI-SANDBOX-001 ya está registrado como `DONE` en el estado local de Sandbox, con gates técnicos y revisiones aprobados. `CS-CORE-20261011-002` está importado y `ACKNOWLEDGED` allí con evidencia y hash de INTEROP-2.8 coincidente. Esto satisface las dos precondiciones locales para activar el campo cuando Core complete WI-CORE-037. El ACK por sí solo no equivale a implementación; la evidencia de WI-SANDBOX-001 cubre esa parte.
- No se requiere que Core cambie SDD 2.1 de Sandbox ni que declare una línea base global común. La diferencia de versión SYSTEM entre Core y el espejo de Sandbox no impide este corte aditivo: Sandbox importó expresamente INTEROP-2.8 para WI-SANDBOX-001. No se afirma por esto una homologación más amplia.

## Blockers

Ninguno para la revisión contractual del alcance. La implementación Core sigue pendiente y el campo no debe enviarse antes de implementarla y verificarla.

## Archivos y evidencia revisados

- `spec/contracts/interoperability-contract.md` §1, §6.1–6.2 y §7.2: DTO Core→Sandbox, raíz congelada, omisión legacy, huella de idempotencia, rutas repo-relative y reglas de aislamiento.
- `spec/contracts/system-contract.md` §6 y §172; `spec/features/019-project-root-detection/{spec,plan,tasks}.md`; `harness/work-items.json` WI-CORE-037: límites, criterios y dependencia de Sandbox.
- `harness/reports/wi-core-036-contract-review.md` y `harness/reports/wi-core-036-implementation.md`: WI-036 separó el transporte al Sandbox y dejó explícito el gate previo.
- `/Users/jean/Tesis/workspaces/tjc-be-test-execution-sandbox/harness/state.json`: WI-SANDBOX-001 `DONE`, gates `PASSED`, revisiones contractual/técnica independientes aprobadas.
- `/Users/jean/Tesis/workspaces/tjc-be-test-execution-sandbox/harness/contract-sync/inbox/CS-CORE-20261011-002.json` y `harness/reports/wi-sandbox-001-contract-sync-acknowledgement.md`: importación, ACK y SHA `755c3357ca047ede9fb318a40a594cc68a63fc63f2b9f4c58af93c28f51a8d90`.
- `/Users/jean/Tesis/workspaces/tjc-be-test-execution-sandbox/harness/reports/wi-sandbox-001-project-root.md`: implementación, pruebas, lint, build, E2E Docker y revisiones aprobadas.
- Código Sandbox en `app/src/workspace/project-root-resolver.ts`, `app/src/executions/execution-fingerprint.ts`, `app/src/executions/execution-pipeline.service.ts`, `app/src/materialization/artifact-materializer.ts` y sus pruebas: validación de root, identidad, cwd y paths repo-relative.
- En Core se inspeccionaron `app/src/sandbox/sandbox-execution.service.ts`, `app/src/sandbox/sandbox.types.ts`, `app/src/validation/analysis-run-validation-job.handler.ts` y `app/src/experiments/experiment-job.handler.ts`. El DTO/tipo Core todavía no incluye `projectRoot`, como corresponde a un WI seleccionado aún no implementado.

## Recommended next step

Iniciar la implementación delegada de WI-CORE-037. Extender el tipo/request de Sandbox y los call sites de validación y experimentos para enviar exactamente `ProjectVersion.effectiveProjectRoot`; conservar los `requestId` derivados actuales y los `relativePath` repo-relative. Añadir regresiones para PHP anidado, omisión legacy, request/idempotencia, prefijo de artefactos y `NODE_TYPESCRIPT`. La evidencia actual de Sandbox y el ACK de `CS-CORE-20261011-002` permiten comenzar; no falta confirmación adicional del componente.
