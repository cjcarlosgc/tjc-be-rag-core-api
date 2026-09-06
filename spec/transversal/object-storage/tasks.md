# object-storage — Tareas

- [x] Consolidar la abstracción interna `ObjectStorageService` (put/get/delete/presignGet o streaming) y su token de inyección.
- [x] Implementar el adaptador de Supabase Storage mediante `@supabase/supabase-js` y retirar el adaptador/dependencias anteriores.
- [x] Actualizar tests de contrato, keys, errores y cleanup para Supabase Storage.
- [x] Usar bucket privado configurable `repository-zips`, key versionada y cargas sin sobrescritura (`upsert=false`).
- [ ] Integrar la emisión de `EphemeralDownloadRef` con expiración corta, SHA-256 y tamaño al implementar HU12/HU13.
- [ ] Verificar que logs y persistencia no conserven URLs firmadas completas.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
