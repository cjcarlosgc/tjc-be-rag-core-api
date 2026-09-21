# 001-project-management — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU01, HU63 (workspace, renombre y eliminación por Admin; ver `014-organizations-access`)

## Objetivo

Gestionar la identidad estable de un proyecto y su versión actual exitosa.

## Reglas y comportamiento

- `Project` representa el proyecto lógico.
- `Project.currentVersionId` solo cambia al completar exitosamente una indexación.
- Crear proyecto no implica indexarlo.
- No borrar físicamente historial de versiones/runs desde V1. Eliminar un Project (HU56, `DELETE /projects/{projectId}`) es lógico (`deletedAt`): conserva versiones, Runs y Functional Knowledge como evidencia, los oculta por API y libera el binding de repositorio; no hay restauración.
- Un `Project` pertenece a un workspace (personal u organización, HU63/`DEC-ORG-001`) que se fija al crearlo. `PATCH /projects/{projectId}` renombra (solo Admin) y `DELETE` solo lo hace un Admin; crear en una organización exige ser su owner. Un Project nace sin repositorio y solo lo ven sus Admin hasta que se vincula uno. Un Project personal solo lo ve su creador (siempre Admin); no se comparte con colaboradores, solo mediante organizaciones (`DEC-ORG-002`). Detalle: `INTEROP-2.4` §6.1 y §6.13.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
