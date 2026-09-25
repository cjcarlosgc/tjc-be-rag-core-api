# 010-product-experience — Plan

## Dependencias

- `001-project-management` (`Project`), `002-project-version-indexing` (`ProjectVersion`).
- Patrón `Page<T>`/cursor ya establecido en `common/dto/page.response.ts` y `common/dto/pagination-query.dto.ts`.

## Diseño técnico

Patrón `take + 1` / cursor por id en `ProjectsRepository.findAll` y `ProjectVersionsRepository.findByProject`. `ProjectVersionSummaryResponse` extiende `ProjectVersionResponse` con los campos del contrato (`detectedFramework`, `targetsTotal`, `targetsWithTest`, `targetsMissingTest`, `current`); `current` se deriva comparando cada versión contra `Project.currentVersionId`, no se persiste como columna. No se crea una versión mediante ZIP manual.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos (paginación, cursor, `current`, 404).
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
