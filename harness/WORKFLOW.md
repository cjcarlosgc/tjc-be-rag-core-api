# Workflow SDD

## Estados

`SELECTED -> SPEC_VERIFIED -> AWAITING_APPROVAL -> IN_PROGRESS -> IN_REVIEW -> DONE`

`BLOCKED` puede utilizarse desde cualquier estado no terminal.

## Flujo

1. **SELECTED:** elegir un work item del backlog y registrar `storyIds`, `sprint`, `specPaths`.
2. **SPEC_VERIFIED:** el analyst confirma que spec/plan/tasks son coherentes, que dependencias existen, que la puerta de decisiones fue evaluada y que no quedan decisiones pendientes que bloqueen el alcance.
3. **AWAITING_APPROVAL:** esperar aprobación humana del alcance cuando el cambio altere comportamiento, contratos o arquitectura.
4. **IN_PROGRESS:** implementer desarrolla únicamente el alcance aprobado dentro de `app/`.
5. **IN_REVIEW:** reviewer verifica contrato, pruebas, errores, seguridad, observabilidad y no ampliación de alcance.
6. **DONE:** lint/test/build pasan, evidencia se registra en `harness/reports/`, tareas aplicables quedan cerradas y `activeWorkItem` vuelve a `null`.

## Puerta de decisiones

Antes de pasar a `SPEC_VERIFIED`:

1. Revisar únicamente `specPaths` y `transversalPaths` del work item activo, además de la constitución y dependencias que esas specs referencien.
2. Identificar decisiones `PENDING` o `PROPOSED` mediante sus IDs y su campo `Blocks`.
3. Registrar los IDs aplicables en `decisionGate`; no copiar el texto de las decisiones al estado.
4. Si existe un ID bloqueante, usar `BLOCKED` y formular una pregunta concreta. Las decisiones de otras features o asuntos académicos no implementables no bloquean el trabajo activo.
5. Si aparece una decisión bloqueante durante la implementación, detener el punto afectado y volver a `BLOCKED`; no elegir silenciosamente una alternativa.

Ejemplo: si `DEC-MET-001` declara que solo bloquea mutation testing, una tarea ordinaria de generación registra ese ID como no aplicable o no bloqueante y continúa. Si el work item intenta integrar StrykerJS, `decisionGate.blockingDecisionIds=["DEC-MET-001"]`, el estado pasa a `BLOCKED` y se formula la pregunta de la spec.

## Handoffs externos

Al recibir contexto de ChatGPT, documentos de tesis u otra fuente externa:

1. Separar explícitamente decisiones aprobadas, propuestas y preguntas pendientes.
2. Contrastar cada dato con la spec vigente y señalar contradicciones.
3. Consolidar solo cambios funcionales aprobados en la spec canónica y registrarlos en `CHANGELOG.md`.
4. Excluir bibliografía, personas, organización académica y razonamiento histórico que no sean necesarios para implementar o revisar el software.

## Cambios de SDD

No se agregan “enmiendas” acumulativas dentro de una spec. Una decisión aprobada modifica el texto canónico, actualiza plan/tasks afectados, incrementa versión si corresponde y registra el cambio en `CHANGELOG.md`. `sddVersion` representa la línea base conjunta y debe quedar homologada en los tres repositorios antes de commit; `SYSTEM-*` e `INTEROP-*` mantienen versionado propio. Git conserva el historial fino.

## Commits y cierre de sprint

La política canónica está en `spec/constitution/delivery-workflow.md`.

1. Durante `IN_PROGRESS`, dividir el trabajo en commits coherentes y verificables; una HU puede usar varios commits y un commit puede referenciar varias HU.
2. Usar un asunto compatible con Conventional Commits y añadir al cuerpo `Refs: HUxx[, HUyy...]` con todas las HU afectadas. `Decisions: DEC-...` es opcional y no sustituye las HU.
3. Completar la revisión de cada work item antes de `DONE`.
4. Al cerrar el sprint, el reviewer revisa el rango acumulado que se pretende publicar y registra el resultado en `harness/reports/sprint-<N>-review.md`; una entrega extraordinaria usa `harness/reports/delivery-<scope>-review.md`.
5. Solo un veredicto `APPROVED`, con lint/test/build aplicables en verde y sin cambios posteriores al commit revisado, habilita el push. Se admite después un único commit `docs(review)` que solo incorpore esos reportes, previa comprobación del reviewer; cualquier otra diferencia exige nueva revisión completa.
6. Commit y push continúan requiriendo solicitud humana explícita. Un push extraordinario antes de cerrar el sprint requiere la misma revisión previa.
