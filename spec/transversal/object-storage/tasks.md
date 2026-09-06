# object-storage — Tareas

- [x] Consolidar la abstracción interna `ObjectStorageService` (put/get/delete/presignGet o streaming) y su token de inyección.
- [x] Implementar el adaptador de Supabase Storage mediante `@supabase/supabase-js` y retirar el adaptador/dependencias anteriores.
- [x] Actualizar tests de contrato, keys, errores y cleanup para Supabase Storage.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
