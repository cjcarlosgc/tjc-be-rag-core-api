# Modelo de planificación y ejecución

**Estado:** aprobado para Core y Console. Sandbox se incorporará en otro corte sin editar su repositorio ahora.

## Niveles y propiedad

| Nivel | Identidad | Ubicación | Qué decide |
| --- | --- | --- | --- |
| Épica | `EP01`–`EP06` | `spec/backlog.md` | Área de valor fija. No se abren nuevas épicas en el flujo ordinario. |
| Historia | `HU01`–`HU18` | `spec/backlog.md` + feature | Resultado observable transversal. No se abre una HU por cada idea. |
| Caso | `OC01`–`OC15`, luego `OCxx.a` | `spec/operational-cases.md` + feature | Escenario de operación y sus subcasos aprobados. No es una tarea. |
| Subtarea | `ST-<COMP>-<NNN>` | `spec/features/<feature>/tasks.md` | Trabajo técnico verificable; declara HU, componente y WI. |
| Work item | `WI-<COMP>-<NNN>` | `harness/work-items.json` + `harness/state.json` | Corte implementable local con gates, revisiones y evidencia. |
| Idea | `IDEA-<NNN>` | `spec/ideas.md` | Propuesta sin compromiso de implementación. |

`COMP` es `CORE`, `CONSOLE`, `SANDBOX` o `GH`. El prefijo numérico no marca el orden de ejecución ni divide la HU en “parte 01”; solo evita colisiones. Los work items pertenecen al repositorio que cambia: Core no crea un WI de Sandbox. Cada subtarea corresponde a un WI local; si el trabajo necesita varios cortes, se divide en subtareas distintas. Un WI puede agrupar subtareas afines. Cada WI declara `component`, `storyIds`, `taskIds`, `caseIds`, dependencias, `contractImpact` y `publishesContract`. Este último solo es verdadero si el componente dueño publica un evento Contract Sync, no si solo consume el contrato. Historias, casos y subtareas son Markdown, no JSON paralelo; el JSON existe solo para el estado ejecutable del Harness.

## Estados visibles

El prefijo identifica el dueño del estado. Los nombres son ingleses en todos los componentes nuevos; los valores históricos sin prefijo se migran al registrarse en el nuevo flujo.

- Idea: `I-CAPTURED → I-TRIAGED → I-BACKLOGGED → I-SELECTED`; salida alternativa `I-DECLINED`.
- HU fija: `H-BACKLOGGED → H-READY → H-IN_PROGRESS → H-DONE`; `H-RETIRED` exige decisión explícita y no borra evidencia. `H-DRAFT` solo se usa para revisar el texto de una HU existente.
- Caso: `O-CATALOGUED → O-READY → O-IN_PROGRESS → O-COVERED`; `O-DEFERRED` conserva el escenario sin prometer cobertura.
- Subtarea: `T-BACKLOGGED → T-READY → T-IN_PROGRESS → T-DONE`; `T-CANCELLED` para trabajo descartado. `T-DONE` referencia evidencia y WI terminado.
- WI: `W-PLANNED → W-READY → W-SELECTED → W-SPEC_VERIFIED → W-AWAITING_APPROVAL → W-IN_PROGRESS → W-IN_REVIEW → W-DONE`; `W-BLOCKED`, `W-DECISION_REQUIRED` y `W-CANCELLED` son salidas explícitas. No se salta la aprobación humana para cambios funcionales.
- Decisión: `D-PROPOSED`, `D-PENDING`, `D-APPROVED`, `D-REJECTED`; el ID sigue siendo `DEC-...` y su `Blocks` determina alcance.
- Contract Sync: `C-PENDING`, `C-ACKNOWLEDGED`, `C-RESOLVED`, `C-REJECTED`; el ID es `CS-AAAAMMDD-NNN`.
- Gate: `G-NOT_RUN`, `G-PASSED`, `G-FAILED`, `G-NOT_APPLICABLE`. El gate es una comprobación con evidencia, no una fase ni un rol.

## De una idea a una implementación

1. Capturar la idea sin abrir épica/HU/WI automáticamente. Una idea “al fondo” queda `I-BACKLOGGED`; una descartada, como mutation testing para este alcance, queda `I-DECLINED`.
2. Al priorizarla, identificar HU fija, criterios de aceptación, feature, caso operativo si aplica y componentes. Si no cabe honestamente en las 18 HU, pedir una decisión de cambio de alcance; no forzar el encaje.
3. Crear o ajustar subtareas en el `tasks.md` dueño y WIs locales por componente. Declarar dependencias `dependsOn` solo cuando hay un bloqueo real. El Harness actual permite **un WI activo por repositorio**, pero Core y Console pueden tener un WI activo a la vez; dentro de cada WI, los agentes pueden trabajar en paralelo y reunirse para revisión. La paralelización de dos WI dentro del mismo repositorio requeriría ampliar `state.json` a múltiples activos y su validador.
4. Seleccionar un WI. Hacer Contract Sync `start`, verificar spec, decisiones y dependencias; solicitar aprobación humana de cualquier nuevo comportamiento/contrato/arquitectura antes de implementar.
5. Implementar con agentes compatibles en paralelo; cada agente entrega evidencia. Hacer Contract Sync `implementation-delivery`, luego `before-review`. Por defecto, el usuario es el reviewer independiente y recibe diff, criterios y evidencia; solo a petición explícita se delega esa revisión a un agente. Revisores especializados pueden actuar en paralelo según el impacto.
6. Corregir hallazgos, ejecutar gates y Contract Sync `before-done`. Solo entonces `W-DONE`. La HU llega a `H-DONE` únicamente al completar todos sus criterios y WIs necesarios con evidencia de aceptación.

Para retirar una capacidad previamente implementada, se crea una subtarea/WI de retirada ligado a la HU afectada. Se eliminan UI, rutas y reglas obsoletas; los datos persistidos se inventarían antes de cualquier purga. Git y `CHANGELOG.md` conservan la historia. Nunca se interpreta “retirar” como autorización para borrar indiscriminadamente evidencia o snapshots internos.

## Gates y revisiones

Los gates se evalúan al cruzar el hito que protegen: spec/decisiones antes de `W-SPEC_VERIFIED`; aprobación antes de `W-IN_PROGRESS`; checks técnicos y Contract Sync antes de `W-IN_REVIEW`; revisión independiente, compatibilidad, evidencia y PULL final antes de `W-DONE`. `G-PASSED` exige comando, resultado o reporte verificable. Un handoff `APPROVED` no equivale por sí solo a gate aprobado. Si un componente necesita un endpoint de otro, publica `CONTRACT_SYNC` dirigido al dueño, crea WIs separados y declara `dependsOn`; no inventa el endpoint en Console ni se cierra antes de verificar el contrato consumidor.

Los checkpoints de Contract Sync son `start`, `implementation-delivery`, `before-review` y `before-done`. Una revisión de rango antes de push es distinta de la revisión del WI; no hay push, PR o merge sin petición explícita del usuario.
