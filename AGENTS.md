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
- SDD 3.0 es la línea base solicitada para Core/Console; `planningBaseline` marca que Sandbox continúa en 2.1 y la homologación global sigue pendiente. No declarar ni publicar una línea base común de los tres antes de esa homologación. `SYSTEM-*` e `INTEROP-*` conservan versionado independiente.
- Mantener `storyIds`, `taskIds`, `component` y `sprint` en el WI activo; cada subtarea nueva de `tasks.md` enlaza un WI de `harness/work-items.json`.
- Implementar por cortes coherentes; dos desarrolladores pueden trabajar en paralelo.
- Cada commit debe ser un cambio coherente y declarar en el cuerpo `Refs: HU...` con todas las historias afectadas.
- No marcar una tarea como terminada sin evidencia verificable.
- Antes de cerrar: lint, test y build; agregar pruebas para correcciones cuando sea viable.
- Antes de declarar un WI terminado, el usuario es el reviewer independiente por defecto; el leader debe presentar diff y evidencia, y esperar su veredicto. Solo delega esa revisión a un agente `reviewer` si el usuario lo pide explícitamente (WI por WI) o mientras el «Modo fuera de casa» esté activo (ver abajo). El implementer no puede autoaprobarse; la revisión delegada tampoco sustituye la aprobación humana de alcance/arquitectura.
- Antes de hacer push al cierre del sprint, el reviewer debe aprobar el rango completo que se publicará y registrar la evidencia de revisión.
- Commitear por corte con sentido lógico sin pedir permiso previo (`spec/constitution/delivery-workflow.md`, "Puerta de push"). No hacer push, PR, merge o cambios de infraestructura externa sin solicitud explícita en cada ocasión.
- Si la causa raíz de un fallo está en otro componente (Developer Console, Test Execution Sandbox), no corregirla en ese repositorio: diagnosticar y entregar una indicación compacta al agente propio de ese componente (`spec/constitution/delivery-workflow.md`).
- Esta sesión (RAG Core API) es la sesión desde la que el usuario coordina el trabajo con los demás componentes; puede delegar hacia la sesión de agente de otro componente, pero solo enviando el handoff después de que el usuario lo confirme explícitamente (`spec/constitution/delivery-workflow.md`, "Delegación entre sesiones de agente").
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

- Leader → Sonnet 5.5 / Medium; SDD Analyst → Sonnet 5.5 / Low; Implementer → Haiku 5.5 / Low; Implementer High → Haiku 5.5 / High; Contract Reviewer → Sonnet 5.5 / Low; Reviewer → Sonnet 5.5 / Medium (solo por delegación o Modo fuera de casa); Human Reviewer → usuario. Fuente: `harness/agent-profiles.yaml`; adaptador Claude en `.claude/agents/`.
- Sonnet 5.5 Medium es el techo automático. El Leader puede escalar `Implementer Low → Implementer High` sin permiso del usuario, dejando un motivo breve en el handoff. El Leader delega toda implementación de `app/` a `Implementer` o `Implementer High`, salvo un cambio mínimo (hasta 10 líneas en 2 archivos, solo pruebas, fixtures, configuración de pruebas o texto, sin lógica de producto, migraciones, contratos, autorización, concurrencia ni seguridad), que declara como hecho por el leader con motivo; ante la duda, delega y no fragmenta un cambio mayor en varios mínimos. No hay escalamiento automático Haiku → Sonnet: si Haiku High no basta, `BLOCKED` o `DECISION_REQUIRED`.
- El reviewer independiente por defecto es el `Human Reviewer` (usuario). Un reviewer IA (`reviewer`, Sonnet 5.5 / Medium) solo se usa si el usuario delega explícitamente la revisión o mientras el **Modo fuera de casa** esté activo.
- **Modo fuera de casa:** DESACTIVADO por defecto; solo el usuario lo activa o desactiva, expresamente en chat, y el leader nunca lo activa por inferencia. Queda registrado en `harness/state.json` como `awayMode: { enabled, activatedBy: "user", activatedAt, quote }` (y al desactivarlo `deactivatedAt`/`deactivationQuote`). Mientras está activo, la revisión independiente de cada WI la hace el agente `reviewer` sin que el usuario delegue WI por WI. Límites que no cambian: no sustituye decisiones `DEC` ni aprobaciones de alcance o contrato (ante una, `DECISION_REQUIRED` y esa parte queda aparcada, sin `W-DONE`); no autoriza push, PR ni infraestructura externa; no relaja ningún gate; el máximo de 2 ciclos de revisión sigue vigente y al agotarse queda pendiente para el usuario, sin inventar aprobación; un reviewer que no sea independiente del implementer no cuenta.
