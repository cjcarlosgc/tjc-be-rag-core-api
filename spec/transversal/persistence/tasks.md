# persistence — Tareas

- [x] Modelo Prisma (`Project`, `ProjectVersion`, `CodeChunk`, `Job`).
- [x] Migraciones versionadas (incluye `CREATE EXTENSION vector`).
- [x] Índices relacionales vigentes.
- [ ] Definir y migrar el índice vectorial definitivo (`DEC-EMB-001` ya `APROBADO`: `text-embedding-3-small`, 1536); el HNSW provisional fue retirado por la última migración actual y `004-rag-retrieval-context` consulta hoy sin índice ANN dedicado (aceptable en el volumen de datos de V1; queda como mejora de performance, no de corrección).
- [x] Repositorios y transacciones (`$transaction` en `completeAndPromote`).
- [x] Añadir tablas de runs/resultados/artifacts/experimentos en sus work items (`test_generation_runs`, `target_run_results`, `artifacts` en 005-007; `experiment_runs`, `experiment_repetitions` en 008; todas con migraciones generadas vía `prisma migrate diff --from-config-datasource` y aplicadas contra la Supabase real).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
