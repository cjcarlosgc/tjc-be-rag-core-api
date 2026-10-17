# WI-CORE-027 — Implementación (exportación de evidencia versionada y jerarquía de métricas)
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high

Cortes A, B, C, E, F y D por `implementer-high` (Haiku 5.5 / high; motivos: seguridad del saneado, migración y captura, ensamblado y concurrencia). Reporte redactado por el leader a partir de los informes de los implementers; los checks y las verificaciones por commit los corrió el leader.

## Commits de código (cada uno compila con `tsc -p tsconfig.build.json` en worktree desechable con `prisma generate`; trailer Haiku 5.5)
- `9293ef2` corte A: helper de saneado ampliado (Slack, Stripe, Google, npm, Cookie/Set-Cookie, `credential|auth|signature`, `password hunter2`, secretos en ruta de URL), validación de `code` y `category`, guarda de escritura, log saneado e IDEA-015.
- `1cd66e8` corte B: migración aditiva `20261009190000_evidence_persistence` (11 columnas nullable y 2 CHECK), `LLMGenerationResult.effective`, `SandboxExecutionResult` con `requestId`/`correlationId`/`durationMs`, hechos de Sandbox por función explícita de 14 claves (sin `testCases`), captura best-effort en los handlers.
- `32b4ebb`, `7b5f087`, `d17cd59` corte C: módulo `app/src/evidence` (tres rutas Reader, ensamblador, servicio, DTO, repositorio), reutilización de targets y publicación del trace, prueba de esquema estable, claves prohibidas, matriz e2e.
- `a5513a8` corte E (alcance adicional declarado): `ContextTracesRepository.beginAttempt` usa `$executeRaw` para el advisory lock (`$queryRaw` fallaba con «Failed to deserialize column of type void» también en PostgreSQL 17.6 real).
- `275f687` corte F: `sandbox[].durationMs` de EXPERIMENT desde `executionDurationMs`, `durationMs` negativo persistido como `null`, etiqueta de namespace URL.
- `55e3ec9` corte D: `StrategyMetricsResponse` con tasas y duraciones `number | null`, `evaluableRepetitions`/`nonEvaluableRepetitions` (DEC-EVID-001).
- Cambios mínimos del leader (declarados, solo pruebas): `29505f2` (1 línea en `evidence.repository.pg.spec.ts`).
- Documentos: `2d203cb` (§6.16 congelado), `c96e1e8` (estado Implementado de `/evidence` y de §6.5).

## Verificación (leader, 2026-10-09, HEAD)
- lint 0; build 0; `tsc --noEmit` 43 con cliente regenerado; `pnpm test` x3: 1984 pasan, 104 omitidos, 2088 total; e2e con URL inalcanzable 246 pasan.
- Specs pg (6 archivos: context-traces, evidence, retrieval-comparisons, evidence-persistence-migration, analysis-trace, jobs) en PostgreSQL 14 desechable con las 46 migraciones y shim de pgvector solo en copia: 104/104 (tras corregir una expectativa vieja, `29505f2`); el desechable se bajó y borró.
- Mutación del corte D: con `experiments.service.ts` anterior (`c96e1e8`) y el spec nuevo fallan 5 pruebas; con el código nuevo pasan 33/33.
- Rendimiento del helper de saneado (corte A): peores casos a ~200k caracteres entre 1 y 6 ms.

## Contratos y sincronización
- INTEROP-2.7 §6.16 `/evidence` y §6.5/§6.5.1 en Implementado (`2d203cb`, `c96e1e8`), sin `INTEROP-2.8`. `contract-reviewer`: APPROVED previo (`wi-core-027-contract-review.md`, `-6-5.md`), CHANGES atendidos en el corte F (`-c.md`) y coherencia final (`-d.md`).
- `CS-CORE-20261009-014` (CS-1, evidencia, `breaking=true`, `sourceRevision` `275f687`) y `CS-CORE-20261009-015` (CS-3, agregados, `breaking=true`, `sourceRevision` `55e3ec9`) hacia Console, `C-PENDING`; el outbox queda en Core hasta que el usuario decida que Console importe.

## Decisiones del usuario aplicadas
DEC-EVID-001 (null + contadores, interpretación de `executionDurationMs` null), 002 (enmienda B), 003 (migración aditiva), 004 (saneado + IDEA-015 en el corte A), 005 (`retrievalId = contextId = ContextTrace.id`; `snapshotRef` UUIDv5 de `urn:tjc:snapshot-ref:v1:…`, namespace URL), 006 (categoría sin NONE), 007 (config nullable).

## Deudas
- Migraciones `20261009190000` (027) y anteriores sin aplicar a una base real (`130000`, `140000`, `150000`, `160000`, `170000`, `180000`); verificación con Postgres/pgvector real pendiente del agente principal (el `$queryRaw` void ya lo confirmó en 17.6).
- `IDEA-017`: `ExperimentRepetitionResponse` emite `generationDurationMs ?? 0` y `totalDurationMs ?? 0` por repetición (0 inventado); WI aparte.
- `IDEA-016` residual (log de `category`/`code`, familias sin patrón, Cookie hasta el final).
- `executionDurationMs` negativo de la repetición de EXPERIMENT se guarda tal cual (sin CHECK) y la evidencia lo emite `null` vía `toCount`.
- `runnerHint`: `string | null` en §6.16, `'JEST' | 'VITEST' | null` en el DTO y `toRunnerHint` descarta PHPUNIT hasta `WI-CORE-028` (PHP en pausa).
- `modelVersion` siempre `null`; dependencia cruzada sandbox/validation hacia experiments (D7); el patrón `$queryRaw` con funciones void no lo cubre ningún lint.
- Notas de `IDEA-016` aceptadas: `code` fuera de `^[A-Za-z0-9_.:-]{1,64}$` deja el hecho en null; Cookie/Set-Cookie redactan hasta el final.

## Notas de la revisión independiente (2026-10-10)
- El commit `275f687` (corte F) dejó roja la expectativa `durationMs: null` del spec pg de evidencia hasta `29505f2` (cambio mínimo del leader, sin reescribir historia); los gates por defecto no lo veían porque ese spec se omite sin URL.
- Comentario obsoleto de `evidence.repository.pg.spec.ts` limpiado como cambio mínimo declarado del leader (solo comentario, 1 archivo, 4 líneas).
- `IDEA-018`: `artifactHash` se calcula antes de saber si el contenido llegó al Sandbox (inofensivo).
- `sourceRevision` de `CS-CORE-20261009-014` (`275f687`) y `-015` (`55e3ec9`) anteceden a las correcciones finales de texto (`3f06f44`); no se reescriben (README de Contract Sync) y queda la nota en sus reportes de publicación: Console toma §6.16 y §6.5 de la revisión final de documentos de Core.
