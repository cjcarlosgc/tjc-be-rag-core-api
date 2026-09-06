# Evidencia — HU20 (historial de generaciones)

**Sprint:** Sprint 3 (inicio) · **Historia:** HU20 · **Estado:** DONE

## Contexto

Primera pieza de Sprint 3 (`009-history-realtime-repair`). El contrato `INTEROP-1.0` ya describía el patrón `Page<T>`/cursor desde el principio, pero ningún endpoint lo había implementado realmente en código (los listados de `GET /projects` y `GET /projects/{id}/versions` quedaron como "aprobados para implementar", nunca construidos). Esta es la primera implementación real de ese patrón.

## Cambios de código

- **Contrato**: `INTEROP-1.1 → 1.2` (aditivo): `GET /project-versions/{projectVersionId}/test-runs?cursor&limit` → `200 Page<TestRunSummaryResponse>`. No cambia ningún DTO/ruta existente.
- **`src/common/dto/`** (nuevo): `Page<T>` genérico, `PaginationQueryDto` (`cursor` UUID opcional, `limit` entero 1-100 opcional, default 20 aplicado en el service).
- **`TestGenerationRunsRepository.findByProjectVersion`**: pide `take + 1` filas (`orderBy: createdAt desc, id desc`) para saber si hay página siguiente sin una segunda consulta; usa el cursor nativo de Prisma (`cursor: {id}, skip: 1`).
- **`TestGenerationService.getHistory`**: valida que la `ProjectVersion` exista (`PROJECT_VERSION_NOT_FOUND`), arma la página y el `nextCursor` (id del último item devuelto, o `null` si no hay más).
- **`TestGenerationController`**: `GET /project-versions/:id/test-runs`.

## Verificación

- `pnpm lint` → OK.
- `pnpm test` → 167/167 (nuevas: `test-generation.service.spec.ts`, 5 casos — 404, detección de página siguiente, `nextCursor` null, mapeo de campos, paso del cursor al repositorio).
- `pnpm test:e2e` → 12/12 (nuevo caso en `test-generation.e2e-spec.ts`: crea 2 test-runs reales para la misma `ProjectVersion`, pagina con `limit=1`, confirma orden más-reciente-primero y que la segunda página termina con `nextCursor: null`).
- `pnpm build` → OK.

## Nota de sincronización

Esta adición a `interoperability-contract.md` (propietario canónico de este repositorio) debe reflejarse en las copias espejo de Developer Console y Test Execution Sandbox — responsabilidad del usuario, fuera de este workspace.
