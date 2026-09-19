# object-storage — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

`ObjectStorageService` actúa como puerto interno inyectable y expone put/get/delete/presign o streaming según necesidad, sin filtrar tipos del SDK a la lógica de dominio. El adaptador de infraestructura de Core implementa el contrato con Supabase Storage mediante `@supabase/supabase-js`. Las keys son internas y no dependen de nombres suministrados por el usuario.

Al construir una solicitud `INTEROP-2.1`, Core obtiene la `snapshotKey`, genera una URL firmada de vida corta y adjunta integridad/tamaño. La URL vive solo en tránsito, debe redactarse en observabilidad y nunca se almacena. Los resultados estructurados que retorna Sandbox ingresan otra vez por Core antes de PostgreSQL.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
