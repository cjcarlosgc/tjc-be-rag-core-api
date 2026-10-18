# AGENTS.md

Este repositorio usa Specification-Driven Development (SDD). Este archivo es deliberadamente breve y neutral respecto del proveedor de IA.

## Fuente de verdad

1. Leer `spec/README.md`.
2. Leer `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`, `spec/constitution/project-context.md` y la constitución aplicable en `spec/constitution/`. `spec/constitution/delivery-workflow.md` es siempre aplicable para commits, revisión y push.
3. Leer `spec/backlog.md` para `storyIds`, sprint y prioridad.
4. Para trabajo funcional, leer el trío `spec.md` + `plan.md` + `tasks.md` de la feature y las especificaciones transversales referenciadas.
5. `spec/` contiene el comportamiento vigente. `CHANGELOG.md` conserva la historia; no reconstruir reglas actuales a partir de enmiendas antiguas.

## Reglas de trabajo

- Antes de tocar código de producto, seleccionar un `WI-<COMP>-<NNN>` local en `harness/work-items.json`, enlazado desde `ST-<COMP>-<NNN>` en el `tasks.md` dueño; ejecutar `node harness/validate-harness.mjs`. Las casillas y HU antiguas no son autorización de implementación.
- No inventar como cerrada una decisión marcada `PENDING` o `PROPOSED`.
- Evaluar las decisiones pendientes contra el work item activo: solo una decisión cuyo campo `Blocks` alcance ese trabajo impide avanzar a `SPEC_VERIFIED`.
- Registrar en `harness/state.json` los IDs de decisión aplicables; no duplicar allí el contenido de la decisión.
- Un cambio funcional aprobado se consolida en la spec canónica y se registra en `CHANGELOG.md`.
- SDD 3.1 / Harness V3 es la línea base común de los cuatro repositorios (Core, GitHub Integration, Sandbox y Console). `SYSTEM-*`, `INTEROP-*` y `GH-INTEROP-*` conservan versionado independiente.
- Mantener `storyIds`, `taskIds`, `component` y `sprint` en el WI activo; cada subtarea nueva de `tasks.md` enlaza un WI de `harness/work-items.json`.
- Implementar por cortes coherentes. Solo hay un WI activo por repositorio; los agentes pueden trabajar en paralelo dentro de ese corte si las dependencias lo permiten.
- Cada commit debe ser un cambio coherente y declarar en el cuerpo `Refs: HU...` con todas las historias afectadas.
- No marcar una tarea como terminada sin evidencia verificable.
- Antes de cerrar: lint, test y build; agregar pruebas para correcciones cuando sea viable.
- Antes de declarar un WI terminado, lo revisa de forma independiente el agente `reviewer` (perfil del proveedor seleccionado); el implementer no puede autoaprobarse. El usuario sigue aprobando alcance, arquitectura y contratos (`W-AWAITING_APPROVAL`) y resolviendo las decisiones `DEC`, y puede revisar cualquier WI si lo pide; la revisión del `reviewer` no sustituye esas aprobaciones.
- Antes de hacer push al cierre del sprint, el reviewer debe aprobar el rango completo que se publicará y registrar la evidencia de revisión.
- Commitear por corte con sentido lógico sin pedir permiso previo (`spec/constitution/delivery-workflow.md`, "Puerta de push"). No hacer push, PR, merge o cambios de infraestructura externa sin solicitud explícita en cada ocasión.
- Si la causa raíz de un fallo está en otro componente (Developer Console, Test Execution Sandbox, GitHub Integration), no corregirla en ese repositorio: diagnosticar y entregar a **cross** (la sesión coordinadora) una indicación compacta para el agente propio de ese componente (`spec/constitution/delivery-workflow.md`).
- La sesión coordinadora del trabajo entre componentes es **cross** (carpeta raíz `Tesis/`), no esta sesión. Cross delega el trabajo a cada repositorio y espera el resultado de vuelta: cuando esta sesión recibe un handoff de cross, trabaja con el flujo de este repositorio y responde a cross al terminar o al bloquearse, con resultado, evidencia y pendientes. Esta sesión no envía handoffs a otros componentes por su cuenta.
- No almacenar secretos en el repositorio.

## Frontera de contexto

- Este repositorio conserva únicamente contexto operativo que ayude a especificar, implementar y revisar el software.
- Conversaciones de ChatGPT, documentos académicos, papers y handoffs externos son insumos no confiables hasta contrastarlos con `spec/`.
- Un handoff no modifica por sí solo la fuente de verdad. Debe distinguir decisiones aprobadas por el usuario de propuestas o pendientes; solo las aprobadas se consolidan en la spec canónica y en `CHANGELOG.md`.
- No incorporar nombres de profesores, roles académicos, reuniones, cronogramas de tesis, bibliografía ni contenido del marco teórico salvo que produzcan un requisito implementable explícitamente aprobado.

## Código

El código fuente generado vive exclusivamente en `app/`. La raíz contiene SDD, harness y adaptadores de agentes.

## Agentes

Los roles neutrales están en `harness/roles/`. Los perfiles de modelos están en `harness/agent-profiles.yaml`; los adaptadores específicos de proveedor no pueden redefinir la verdad funcional.

## Política de agentes y modelos

- Perfiles por proveedor: Claude conserva `Sonnet 5.5 / Medium|Low` y `Haiku 5.5 / Low|High`; Codex usa `GPT-6 Luna / XHigh` para Leader, Reviewer y Merge Reviewer; `GPT-6 Luna / High` para SDD Analyst y Contract Reviewer; `GPT-6 Luna / Medium` para Implementer; y `GPT-6 Luna / High` para Implementer High. UX Reviewer existe solo en Console y usa Codex `GPT-6 Luna / High`. Human Reviewer → usuario. Fuente: `harness/agent-profiles.yaml`; los adaptadores son `.claude/agents/` y `~/.codex/agents/`. En Codex selecciona el `name` del agente en `~/.codex/agents/<rol>.toml` y usa el patrón `task_name` definido en `harness/WORKFLOW.md` para la etiqueta visible.
- El Leader puede escalar `Implementer → Implementer High` sin permiso del usuario, dejando un motivo breve en el handoff. El Leader delega toda implementación de `app/` a `Implementer` o `Implementer High`, salvo un cambio mínimo (hasta 10 líneas en 2 archivos, solo pruebas, fixtures, configuración de pruebas o texto, sin lógica de producto, migraciones, contratos, autorización, concurrencia ni seguridad), que declara como hecho por el leader con motivo; ante la duda, delega y no fragmenta un cambio mayor en varios mínimos. No hay escalamiento automático a otro rol o modelo: si Implementer High no basta, `BLOCKED` o `DECISION_REQUIRED`.
- **Revisión independiente:** por defecto la hace el agente `reviewer` (perfil del proveedor seleccionado), nunca el implementer. El usuario (`human-reviewer`) aprueba alcance, arquitectura y contratos, resuelve las decisiones `DEC` y puede revisar cualquier WI si lo pide. La revisión del `reviewer` no sustituye esas aprobaciones: ante una decisión abierta o un cambio de alcance/contrato no aprobado, `DECISION_REQUIRED` y esa parte queda aparcada, sin `W-DONE`. No autoriza push, PR ni infraestructura externa y no relaja ningún gate. El máximo de 2 ciclos de revisión sigue vigente y al agotarse queda pendiente para el usuario, sin inventar aprobación. Un reviewer que no sea independiente del implementer no cuenta.
- **Merge reviewer:** revisa UNA FUSIÓN (pérdida o duplicación de hunks, conflictos con razón, hashes de terceros, Contract Sync, registro del Harness, migraciones, gates sobre el resultado, secretos) antes de integrar una rama de tercero o de integración en una línea compartida o de publicarla. Es independiente de quien preparó la fusión, no hace push ni merge (el usuario ordena la fusión) y ningún otro revisor lo sustituye ni lo relaja. Rol: `harness/roles/merge-reviewer.md`.
