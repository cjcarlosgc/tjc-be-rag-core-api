# 010-product-experience — Especificación

**Estado:** aprobado.
**Historias:** HU25 (alcance backend). HU26 no tiene alcance backend — ver nota más abajo.

## Objetivo

Cerrar la brecha entre lo ya aprobado en `interoperability-contract.md` (sección 8, al aprobarse `INTEROP-1.1`: "listado de proyectos y versiones quedan aprobados para implementar") y el código real: exponer el listado paginado de proyectos y de versiones de un proyecto, para que un cliente pueda "trabajar con múltiples proyectos, versiones y ejecuciones de forma eficiente" (HU25) sin tener que conocer de antemano cada id.

## Reglas y comportamiento

- `GET /projects?cursor&limit` → `Page<ProjectResponse>`, orden `createdAt` descendente (más reciente primero), mismo patrón `Page<T>`/cursor ya usado en HU20.
- `GET /projects/{projectId}/versions?cursor&limit` → `Page<ProjectVersionSummaryResponse>`, orden `createdAt` descendente. `current: true` únicamente en la versión cuyo id coincide con `Project.currentVersionId`; el resto `current: false`. 404 `PROJECT_NOT_FOUND` si el proyecto no existe.
- Ninguno de los dos endpoints acepta parámetros de filtro (por nombre, estado, etc.): el contrato solo definía `cursor`/`limit`, y no se amplía esa forma sin una decisión explícita.
- No se modifica ningún endpoint ni DTO existente.

## Fuera de alcance

- HU26 ("experiencia visual consolidada") no requiere ningún trabajo de backend: todo el dato que necesita ya se expone vía los endpoints existentes (estados, resultados, validaciones) más el listado que agrega esta feature. Es una historia exclusivamente de UI/UX en el/los repositorio(s) de frontend.
- No se agregan filtros/búsqueda por nombre ni por estado a ninguno de los dos listados: no estaban en el contrato aprobado y ampliarlos requeriría una decisión de producto explícita.
- "Estabilización, observabilidad, performance" (mencionados en `spec/constitution/roadmap.md` para Sprint 4) son habilitadores técnicos generales, no historias de usuario; no se abordan aquí salvo que se detecte y documente un gap concreto.
