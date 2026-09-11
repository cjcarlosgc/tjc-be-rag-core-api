# AGENTS.md

Este repositorio usa Specification-Driven Development (SDD). Este archivo es deliberadamente breve y neutral respecto del proveedor de IA.

## Fuente de verdad

1. Leer `spec/README.md`.
2. Leer `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`, `spec/constitution/project-context.md` y la constitución aplicable en `spec/constitution/`. `spec/constitution/delivery-workflow.md` es siempre aplicable para commits, revisión y push.
3. Leer `spec/backlog.md` para `storyIds`, sprint y prioridad.
4. Para trabajo funcional, leer el trío `spec.md` + `plan.md` + `tasks.md` de la feature y las especificaciones transversales referenciadas.
5. `spec/` contiene el comportamiento vigente. `CHANGELOG.md` conserva la historia; no reconstruir reglas actuales a partir de enmiendas antiguas.

## Reglas de trabajo

- No inventar como cerrada una decisión marcada `PENDING` o `PROPOSED`.
- Evaluar las decisiones pendientes contra el work item activo: solo una decisión cuyo campo `Blocks` alcance ese trabajo impide avanzar a `SPEC_VERIFIED`.
- Registrar en `harness/state.json` los IDs de decisión aplicables; no duplicar allí el contenido de la decisión.
- Un cambio funcional aprobado se consolida en la spec canónica y se registra en `CHANGELOG.md`.
- Al actualizar la línea base SDD, homologar `sddVersion` en los tres repositorios antes de commit; `SYSTEM-*` e `INTEROP-*` conservan versionado independiente.
- Mantener `storyIds` y `sprint` en `harness/state.json`.
- Implementar por cortes coherentes; dos desarrolladores pueden trabajar en paralelo.
- Cada commit debe ser un cambio coherente y declarar en el cuerpo `Refs: HU...` con todas las historias afectadas.
- No marcar una tarea como terminada sin evidencia verificable.
- Antes de cerrar: lint, test y build; agregar pruebas para correcciones cuando sea viable.
- Antes de hacer push al cierre del sprint, el reviewer debe aprobar el rango completo que se publicará y registrar la evidencia de revisión.
- No hacer commit, push, PR, merge o cambios de infraestructura externa sin solicitud explícita.
- Si la causa raíz de un fallo está en otro componente (Developer Console, Test Execution Sandbox), no corregirla en ese repositorio: diagnosticar y entregar una indicación compacta al agente propio de ese componente (`spec/constitution/delivery-workflow.md`).
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
