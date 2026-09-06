# 010-product-experience — Plan

## Dependencias

- `001-project-management` (`Project`), `002-project-version-indexing` (`ProjectVersion`).
- Patrón `Page<T>`/cursor ya establecido en `common/dto/page.response.ts` y `common/dto/pagination-query.dto.ts` (HU20).

## Diseño técnico

Mismo patrón `take + 1` / cursor por id ya usado en `TestGenerationRunsRepository.findByProjectVersion` (HU20), replicado en `ProjectsRepository.findAll` y `ProjectVersionsRepository.findByProject`. `ProjectVersionSummaryResponse` extiende `ProjectVersionResponse` con los campos que ya definía el contrato (`detectedFramework`, `targetsTotal`, `targetsWithTest`, `targetsMissingTest`, `current`); `current` se deriva comparando cada versión contra `Project.currentVersionId`, no se persiste como columna.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos (paginación, cursor, `current`, 404).
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
