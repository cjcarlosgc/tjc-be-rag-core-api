# AGENTS.md

Este repositorio usa Specification-Driven Development (SDD). Este archivo es deliberadamente breve y neutral respecto del proveedor de IA.

## Fuente de verdad

1. Leer `spec/README.md`.
2. Leer la constitución aplicable en `spec/constitution/`.
3. Leer `spec/backlog.md` para `storyIds`, sprint y prioridad.
4. Para trabajo funcional, leer el trío `spec.md` + `plan.md` + `tasks.md` de la feature y las especificaciones transversales referenciadas.
5. `spec/` contiene el comportamiento vigente. `CHANGELOG.md` conserva la historia; no reconstruir reglas actuales a partir de enmiendas antiguas.

## Reglas de trabajo

- No inventar como cerrada una decisión marcada `PENDING` o `PROPOSED`.
- Un cambio funcional aprobado se consolida en la spec canónica y se registra en `CHANGELOG.md`.
- Mantener `storyIds` y `sprint` en `harness/state.json`.
- Implementar por cortes coherentes; dos desarrolladores pueden trabajar en paralelo.
- No marcar una tarea como terminada sin evidencia verificable.
- Antes de cerrar: lint, test y build; agregar pruebas para correcciones cuando sea viable.
- No hacer commit, push, PR, merge o cambios de infraestructura externa sin solicitud explícita.
- No almacenar secretos en el repositorio.

## Código

El código fuente generado vive exclusivamente en `app/`. La raíz contiene SDD, harness y adaptadores de agentes.

## Agentes

Los roles neutrales están en `harness/roles/`. Los perfiles de modelos están en `harness/agent-profiles.yaml`; los adaptadores específicos de proveedor no pueden redefinir la verdad funcional.
