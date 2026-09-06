# Evidencia — HU25 (listado de proyectos y versiones)

**Sprint:** Sprint 4 (backend, primera pieza) · **Historia:** HU25 · **Estado:** DONE

## Contexto

`interoperability-contract.md` ya documentaba desde `INTEROP-1.1` (sección 8) que "listado de proyectos y versiones quedan aprobados para implementar", incluyendo las rutas y los tipos completos (`Page<ProjectResponse>`, `Page<ProjectVersionSummaryResponse>`), pero el código nunca se construyó: `ProjectsController` solo tenía `POST`/`GET :id`, `ProjectVersionsController` no tenía ningún listado. HU25 ("filtros, navegación y organización mejorada, para trabajar con múltiples proyectos, versiones y ejecuciones") depende de que esto exista — sin él, ningún cliente puede descubrir qué proyectos/versiones existen sin conocer los ids de antemano. Como no se agrega ninguna ruta/tipo nuevo al contrato (ya estaban ahí), **no hay cambio de versión INTEROP**.

## Cambios de código

- **`ProjectsRepository.findAll(take, cursor)`**: mismo patrón `take + 1` + cursor por id ya usado en `TestGenerationRunsRepository.findByProjectVersion` (HU20), orden `createdAt desc`.
- **`ProjectsService.list(limit, cursor)`**: arma la página y el `nextCursor`.
- **`ProjectsController`**: `GET /projects?cursor&limit`.
- **`ProjectVersionsRepository.findByProject(projectId, take, cursor)`**: mismo patrón, filtrado por `projectId`.
- **`ProjectVersionsService.listVersions(projectId, limit, cursor)`**: valida que el proyecto exista (`404 PROJECT_NOT_FOUND`), arma la página.
- **`ProjectVersionsController`**: `GET /projects/:id/versions`.
- **`dto/project-version.response.ts`**: `ProjectVersionSummaryResponse` (extiende `ProjectVersionResponse` + `detectedFramework`/`targetsTotal`/`targetsWithTest`/`targetsMissingTest`/`current`) y `toProjectVersionSummaryResponse(version, currentVersionId)` — `current` se deriva comparando contra `Project.currentVersionId`, no es una columna persistida.
- Sin cambios de esquema ni migraciones.

## Verificación

- `pnpm lint` → OK.
- `pnpm tsc --noEmit` → OK (mismos 2 errores preexistentes no relacionados).
- `pnpm test` → 197/197. Nuevos: casos en `projects.service.spec.ts` (`list`: detección de página siguiente, `nextCursor` null, cursor/límite por defecto) y en `project-versions.service.spec.ts` (`listVersions`: 404 `PROJECT_NOT_FOUND`, paginación, `current` solo en la versión que coincide con `currentVersionId`, `targetsMissingTest` null cuando los totales aún no se conocen).
- `pnpm test:e2e` → 17/17. Nuevos: `projects.e2e-spec.ts` (paginación real con `FakePrismaService` actualizado a ids UUID reales — el fake anterior generaba ids `project-N`, incompatibles con `@IsUUID()` de `PaginationQueryDto.cursor`); `project-versions.e2e-spec.ts` (reindexar el mismo proyecto dos veces contra la Supabase real, confirma orden más-reciente-primero y que `current: true` marca solo la última versión completada; 404 sobre un proyecto inexistente).
- `pnpm build` → OK.

## Limitaciones documentadas

- Ninguno de los dos listados acepta filtros (por nombre, estado, etc.) — el contrato aprobado solo definía `cursor`/`limit`; ampliar la forma requeriría una decisión de producto explícita, no incluida en este alcance.
- HU26 (experiencia visual consolidada) no tiene ningún alcance de backend: es puramente UI/UX en el/los repositorio(s) de frontend.
