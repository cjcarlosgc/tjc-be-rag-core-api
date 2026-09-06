# object-storage — Tareas

- [x] Consolidar la abstracción interna `ObjectStorageService` (put/get/delete/presignGet o streaming) y su token de inyección.
- [x] Implementar el adaptador de Supabase Storage mediante `@supabase/supabase-js` y retirar el adaptador/dependencias anteriores.
- [x] Actualizar tests de contrato, keys, errores y cleanup para Supabase Storage.
- [x] Usar bucket privado configurable `repository-zips`, key versionada y cargas sin sobrescritura (`upsert=false`).
- [x] Integrar la emisión de `EphemeralDownloadRef` con expiración corta, SHA-256 y tamaño al implementar HU12/HU13 (`SandboxExecutionService.buildSnapshotRef`/`buildArtifactRef`: `presignGet` + SHA-256/tamaño calculados en memoria sobre el buffer, sin re-descargar).
- [x] Verificar que logs y persistencia no conserven URLs firmadas completas (revisado: la URL firmada solo viaja dentro del body JSON hacia el Sandbox, nunca en la URL de request ni en mensajes de error/log; `sandbox-execution.service.spec.ts` incluye un test de redacción que confirma que un fallo HTTP no filtra la URL firmada en el mensaje de error).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
