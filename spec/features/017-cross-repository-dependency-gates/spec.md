# 017 — Puertas de dependencias entre repositorios

**Estado:** aprobado como endurecimiento técnico del Harness solicitado por el usuario; no agrega épicas, HU ni contratos de producto.

## Objetivo

Evitar que un WI consumidor avance a `W-READY` mientras dependa de entregas de otro repositorio que aún no se verificaron. La comprobación seguirá siendo explícita y auditable: el Harness local no consulta repositorios vecinos ni confía en una notificación como prueba de cierre.

## Reglas

- Un WI con `externalDependencies` declara también `externalDependencyGate`.
- El gate usa estados existentes `G-NOT_RUN`, `G-PASSED` y `G-FAILED`. Mientras no esté `G-PASSED`, el WI solo puede permanecer `W-PLANNED` o pasar a `W-CANCELLED`; no puede seleccionarse, ejecutarse ni cerrarse.
- Las dependencias locales incompletas también impiden que un WI avance a `W-READY` o a fases ejecutables posteriores; el WI dependiente permanece `W-PLANNED` o se marca explícitamente `W-BLOCKED`/`W-CANCELLED`.
- `G-PASSED` requiere un reporte JSON local, revisión manual declarada, SHA completo del origen, fecha verificable y evidencia de cada WI externo requerido en `W-DONE`.
- El reporte enumera todos los Contract Sync emitidos por cada WI origen en ese SHA. Cada evento debe estar importado localmente, coincidir por ID, `source`, `sourceWorkItem`, `sourceRevision` y destinatario, y estar como mínimo `C-ACKNOWLEDGED`. Todos los eventos nuevos deben alcanzar `C-RESOLVED` al completar el WI consumidor; `before-review` y `before-done` lo exigen mediante el gate interop normal.
- El productor publica eventos namespaced como `C-PENDING` sin campos de evidencia local. Solo el consumidor puede registrar sus transiciones; `resolve` exige que su WI activo ya tenga `implementationCompleted: G-PASSED` y un reporte existente en `gateEvidence.implementationCompleted`.
- `C-ACKNOWLEDGED` significa que el consumidor revisó el cambio, aceptó su alcance y tiene un WI planificado para atenderlo; no afirma que el consumidor ya implementó la integración. Así se evita declarar resuelto el cambio antes de empezar el WI consumidor.
- El validador comprueba la forma y consistencia de evidencia disponible localmente. No demuestra por sí solo que la declaración remota sea cierta; esa comprobación manual y la revisión independiente del WI quedan registradas como evidencia.
- Las transiciones ACK/RESOLVED no degradan el estado ni sustituyen una evidencia ya registrada; repetir la misma evidencia es idempotente.
- Cada importación nueva conserva `consumerImportedAt` en el inbox local. La marca no pertenece al payload del productor ni altera su digest. Al validar un WI cerrado, solo se consideran eventos que el consumidor ya había importado al momento de `closedAt`; importar o reconocer posteriormente un evento no reescribe snapshots históricos. Los eventos antiguos sin marca se tratan conservadoramente como ya conocidos al cierre.
- El snapshot activo y el registro completado preservan la declaración y el gate. Cambiar el gate o sus dependencias sin actualizar los snapshots falla la validación.

## Reporte de verificación

El reporte, por ejemplo `harness/reports/external-dependency-verification-wi-core-003.json`, incluye `consumerWorkItem`, `sourceRepositories`, `verifiedAt`, `verifiedBy: "human-reviewer"` y `upstreamWorkItems`. Por componente origen se registra `component`, `repository` y `sourceRevision` (SHA completo de HEAD); cada WI origen contiene `workItemId`, `status: "W-DONE"`, `completionEvidence` y un arreglo completo de eventos `contractSyncs` con `id`, `source`, `sourceWorkItem`, `sourceRevision` del propio evento, `targets`, estado importado y `payloadSha256`. Este último es el SHA-256 del YAML fuente normalizado, sin status ni anotaciones locales. El reporte del HEAD remoto es atestación humana: el Harness valida su coherencia con los eventos locales importados.

## Fuera de alcance

No hay lecturas de git remoto, llamadas entre repositorios, credenciales, cambios al contrato GH-INTEROP, automatización de merges ni cambios a Sandbox. Las dependencias locales continúan expresándose en `dependsOn`; el gate externo no simula un WI de otro componente.
