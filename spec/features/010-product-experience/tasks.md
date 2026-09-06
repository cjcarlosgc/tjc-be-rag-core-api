# 010-product-experience — Tareas

- [x] `GET /projects?cursor&limit` → `Page<ProjectResponse>` (`ProjectsRepository.findAll`, `ProjectsService.list`).
- [x] `GET /projects/:id/versions?cursor&limit` → `Page<ProjectVersionSummaryResponse>` (`ProjectVersionsRepository.findByProject`, `ProjectVersionsService.listVersions`, `toProjectVersionSummaryResponse`), 404 `PROJECT_NOT_FOUND` si el proyecto no existe.
- N/A HU26: sin alcance backend (ver `spec.md`).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
