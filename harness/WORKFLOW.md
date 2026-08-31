# Workflow SDD

## Estados

`SELECTED -> SPEC_VERIFIED -> AWAITING_APPROVAL -> IN_PROGRESS -> IN_REVIEW -> DONE`

`BLOCKED` puede utilizarse desde cualquier estado no terminal.

## Flujo

1. **SELECTED:** elegir un work item del backlog y registrar `storyIds`, `sprint`, `specPaths`.
2. **SPEC_VERIFIED:** el analyst confirma que spec/plan/tasks son coherentes, que dependencias existen y que no se cerraron decisiones pendientes sin aprobación.
3. **AWAITING_APPROVAL:** esperar aprobación humana del alcance cuando el cambio altere comportamiento, contratos o arquitectura.
4. **IN_PROGRESS:** implementer desarrolla únicamente el alcance aprobado dentro de `app/`.
5. **IN_REVIEW:** reviewer verifica contrato, pruebas, errores, seguridad, observabilidad y no ampliación de alcance.
6. **DONE:** lint/test/build pasan, evidencia se registra en `harness/reports/`, tareas aplicables quedan cerradas y `activeWorkItem` vuelve a `null`.

## Cambios de SDD

No se agregan “enmiendas” acumulativas dentro de una spec. Una decisión aprobada modifica el texto canónico, actualiza plan/tasks afectados, incrementa versión si corresponde y registra el cambio en `CHANGELOG.md`. Git conserva el historial fino.
