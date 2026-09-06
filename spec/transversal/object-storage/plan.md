# object-storage — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

`ObjectStorageService` actúa como puerto interno inyectable y expone put/get/delete/presign o streaming según necesidad, sin filtrar tipos del SDK a la lógica de dominio. Un adaptador de infraestructura implementa el contrato con Supabase Storage mediante `@supabase/supabase-js`. Keys internas; no confiar en nombres de usuario.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
