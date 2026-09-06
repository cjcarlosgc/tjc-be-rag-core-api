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

## Handoffs externos

Al recibir contexto de ChatGPT, documentos de tesis u otra fuente externa:

1. Separar explícitamente decisiones aprobadas, propuestas y preguntas pendientes.
2. Contrastar cada dato con la spec vigente y señalar contradicciones.
3. Consolidar solo cambios funcionales aprobados en la spec canónica y registrarlos en `CHANGELOG.md`.
4. Excluir bibliografía, personas, organización académica y razonamiento histórico que no sean necesarios para implementar o revisar el software.

## Cambios de SDD

No se agregan “enmiendas” acumulativas dentro de una spec. Una decisión aprobada modifica el texto canónico, actualiza plan/tasks afectados, incrementa versión si corresponde y registra el cambio en `CHANGELOG.md`. Git conserva el historial fino.
