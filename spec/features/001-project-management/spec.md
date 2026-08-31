# 001-project-management — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU01

## Objetivo

Gestionar la identidad estable de un proyecto y su versión actual exitosa.

## Reglas y comportamiento

- `Project` representa el proyecto lógico.
- `Project.currentVersionId` solo cambia al completar exitosamente una indexación.
- Crear proyecto no implica indexarlo.
- No borrar historial de versiones/runs desde V1.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
