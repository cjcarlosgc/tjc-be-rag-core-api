# persistence — Tareas

- [x] Modelo Prisma (`Project`, `ProjectVersion`, `CodeChunk`, `Job`).
- [x] Migraciones versionadas (incluye `CREATE EXTENSION vector`).
- [x] Índices relacionales vigentes.
- [ ] Definir y migrar el índice vectorial definitivo (`DEC-EMB-001` ya `APROBADO`: `text-embedding-3-small`, 1536); el HNSW provisional fue retirado por la última migración actual y `004-rag-retrieval-context` consulta hoy sin índice ANN dedicado (aceptable en el volumen de datos de V1; queda como mejora de performance, no de corrección).
- [x] Repositorios y transacciones (`$transaction` en `completeAndPromote`).
- [x] Añadir tablas de runs/resultados/artifacts/experimentos en sus work items (`test_generation_runs`, `target_run_results`, `artifacts` en 005-007; `experiment_runs`, `experiment_repetitions` en 008; todas con migraciones generadas vía `prisma migrate diff --from-config-datasource` y aplicadas contra la Supabase real).
- [x] Añadir modelo/migración `IdempotencyRecord` conforme a `DEC-IDEMP-001`, con scope, UUID, SHA-256, operationId, timestamp y unicidad compuesta (migración `20260907010601_idempotency_records`, aplicada contra la Supabase real).
- [x] Implementar transacciones atómicas recurso + registro idempotente + job para generación, experimento y retry; probar replay, conflicto y carrera concurrente (`IdempotencyService`, unit + e2e contra Supabase real).
- [x] Mantener el registro mientras exista el resultado correspondiente y excluir keys/huellas sensibles de DTOs/logs (sin expiración independiente en V1; `idempotencyKey`/`requestFingerprint` nunca se incluyen en ningún DTO de respuesta ni se loguean).
- [ ] **(Backlog Sprint 4)** Persistir el mensaje detallado de `SandboxFailureFact` (hoy solo se loguea en servidor vía `SandboxExecutionService.fetchResult`, ver `sandbox-execution.service.ts`) en una columna de `ExperimentRepetition` y, si aplica, reforzar `TargetRunResult.errorSummary` con el mismo detalle — para que un fallo `DEPENDENCY`/`INFRA` sea diagnosticable desde el resultado persistido, sin depender de grepear logs del servidor. Requiere migración + bump de `spec/contracts/system-contract.md` (contrato de persistencia). Detectado el 2026-09-07 al diagnosticar un experimento `getPokemon` con `failureType: DEPENDENCY` en ambos brazos (causa real: `pnpm-workspace.yaml` del proyecto de prueba sin campo `packages`, ajeno a Core/Sandbox).

## Calidad

- [x] Agregar/actualizar pruebas.
- [x] Verificar manejo de errores.
- [x] Verificar observabilidad mínima.
- [x] Ejecutar lint/test/build.
- [x] Registrar evidencia de revisión en `harness/reports/`.
