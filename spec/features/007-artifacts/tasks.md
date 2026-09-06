# 007-artifacts — Tareas

- [x] Modelo/persistencia artifact (`Artifact` en Prisma; `ArtifactsRepository`).
- [x] Upload a storage (`ArtifactService.persistFinalArtifacts`: sube el contenido final a `test-runs/{runId}/artifacts/{relativePath}`; si el archivo ya existía, además sube el original a `test-runs/{runId}/originals/{relativePath}` para poder diffear después).
- [x] Download individual/all (`GET /artifacts/:id/download`, `GET /test-runs/:id/artifacts/download` como ZIP vía `adm-zip`).
- [x] Diff MODIFIED (`GET /artifacts/:id/diff`: LCS línea a línea entre original y final; `CREATED` → `409 DIFF_NOT_AVAILABLE`).
- [x] Seguridad de rutas y nombres (`assertSafeRelativePath` rechaza `..`/rutas absolutas/backslash antes de construir la storage key; `safeFileName` sanitiza el nombre del `Content-Disposition`).

## Calidad

- [x] Agregar/actualizar pruebas (`artifact.service.spec.ts`, `diff.util.spec.ts`, cubierto también end-to-end en `test-generation.e2e-spec.ts`: artifact CREATED sin diff, artifact MODIFIED con diff, download individual y ZIP).
- [x] Verificar manejo de errores (`ARTIFACT_NOT_FOUND`, `DIFF_NOT_AVAILABLE`).
- [x] Verificar observabilidad mínima (hereda el envelope de errores estándar; sin logging propio adicional necesario en esta capa).
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/` (`005-006-007-generation-pipeline.md`).

## Simplificación deliberada de V1

El diff usa LCS línea a línea (programación dinámica O(n·m)) implementado a mano, sin librería externa. Adecuado para el tamaño típico de un archivo de test; no está pensado para archivos muy grandes.
