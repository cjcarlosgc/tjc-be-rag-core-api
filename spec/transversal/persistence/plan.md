# persistence — Plan

## Dependencias

- Constitución y transversales aplicables.

## Diseño técnico

PostgreSQL + pgvector en Supabase: Prisma para relacional; pgvector mediante TypedSQL/raw SQL y migraciones versionadas. Este almacén conserva datos de dominio, chunks, embeddings vectoriales, jobs y resultados; los blobs corresponden a Supabase Storage. Transacciones para captura de `currentVersion` y cambios de estado críticos. Los despliegues aplican migraciones existentes con `DATABASE_URL` del entorno; no se ejecutan manualmente ni sin credenciales/autorización del entorno destino.

## Validación

- Pruebas automatizadas para reglas determinísticas y contratos.
- Casos positivos, negativos y estados terminales relevantes.
- `lint`, `test` y `build` antes de cierre.
