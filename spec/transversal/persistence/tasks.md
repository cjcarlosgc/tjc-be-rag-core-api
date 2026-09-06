# persistence — Tareas

- [x] Modelo Prisma (`Project`, `ProjectVersion`, `CodeChunk`, `Job`).
- [x] Migraciones versionadas (incluye `CREATE EXTENSION vector`).
- [x] Índices relacionales vigentes.
- [ ] Definir y migrar el índice vectorial definitivo tras resolver `DEC-EMB-001`; el HNSW provisional fue retirado por la última migración actual.
- [x] Repositorios y transacciones (`$transaction` en `completeAndPromote`).
- [ ] Añadir tablas de runs/resultados/artifacts/experimentos en sus work items; no existen todavía en el esquema actual.

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
