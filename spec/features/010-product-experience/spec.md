# 010-product-experience — Especificación

**Estado:** aprobado.
**Historias:** HU01, HU12, HU14

Los listados y sus componentes reutilizables se integran al control plane PR-driven: `RepositoryBinding`, `AnalysisRun`, Action Required, Checks y publicación revisada. No conservan una ruta de producto paralela.

## Objetivo

Permitir recorrer proyectos autorizados y las versiones internas asociadas a sus análisis sin conocer de antemano cada ID. La versión procede del snapshot de un `AnalysisRun`, nunca de una carga manual.

## Reglas y comportamiento

- `GET /projects?cursor&limit` → `Page<ProjectResponse>`, orden `createdAt` descendente (más reciente primero), con el patrón común `Page<T>`/cursor.
- `GET /projects/{projectId}/versions?cursor&limit` → `Page<ProjectVersionSummaryResponse>`, orden `createdAt` descendente. `current: true` únicamente en la versión cuyo id coincide con `Project.currentVersionId`; el resto `current: false`. 404 `PROJECT_NOT_FOUND` si el proyecto no existe.
- Ninguno de los dos endpoints acepta parámetros de filtro (por nombre, estado, etc.): el contrato solo definía `cursor`/`limit`, y no se amplía esa forma sin una decisión explícita.
- No se modifica ningún endpoint ni DTO existente.

## Fuera de alcance

- La composición visual de listados y resultados pertenece a Console; esta feature no define pantallas.
- No se agregan filtros/búsqueda por nombre ni por estado a ninguno de los dos listados: no estaban en el contrato aprobado y ampliarlos requeriría una decisión de producto explícita.
- "Estabilización, observabilidad, performance" (mencionados en `spec/constitution/roadmap.md` para Sprint 4) son habilitadores técnicos generales, no historias de usuario; no se abordan aquí salvo que se detecte y documente un gap concreto.
