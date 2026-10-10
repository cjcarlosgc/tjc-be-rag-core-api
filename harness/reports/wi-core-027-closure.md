# Cierre — WI-CORE-027
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-10 (America/Lima)
**Estado:** `W-DONE`
**Historias:** HU12, HU15, HU17
**Subtarea:** ST-CORE-034

## Revisión
- El usuario aprobó en chat `DEC-EVID-001` a `DEC-EVID-007` (alcance, enmienda de §6.16, migración, saneado, identificadores, categoría de fallo, `config` nullable y agregados con `null` y contadores).
- La revisión independiente la hizo el agente `reviewer` (configurado claude-sonnet-5-5, atendido unknown, medium) por el **Modo fuera de casa** (`awayMode` en `harness/state.json`, activado expresamente por el usuario el 2026-10-09): `APPROVED` en el ciclo 1 de 2, 0 blockers, 0 importantes y 4 menores (`wi-core-027-independent-review.md`); 27 mutaciones detectadas, 104/104 specs pg en PostgreSQL 14 desechable, sin fugas de `excerpt`/`groundTruth`/`testCases`/`knowledgeId`. `reviewCycles` quedó en 1 de 2.
- La revisión no sustituye decisiones `DEC` ni aprobaciones de alcance o contrato del usuario, y no autoriza push, PR ni infraestructura externa.

## Qué entrega
Las tres rutas `GET /{analysis-runs|experiments|retrieval-comparisons}/{id}/evidence` (Reader, `EvidenceBundleResponse` `schemaVersion '1'`, un dato no observado es `null`); migración aditiva `20261009190000`; helper de saneado ampliado (IDEA-015/IDEA-016 resueltas); `StrategyMetricsResponse` con tasas y duraciones `number | null` y `evaluableRepetitions`/`nonEvaluableRepetitions`; corrección de `ContextTracesRepository.beginAttempt` (`$executeRaw`). Detalle y checks en `wi-core-027-implementation.md`.

## Contratos y sincronización
`CS-CORE-20261009-014` (evidencia) y `CS-CORE-20261009-015` (agregados de §6.5) hacia Console, `breaking: true` (solo compilación TypeScript estricta), `C-PENDING`; el outbox queda en Core hasta que el usuario decida que Console importe. Contract Sync `before-done`: sin pendientes relevantes. Con 027 cerrado, `WI-CONSOLE-017` y `WI-CONSOLE-020` quedan habilitados por Core.

## Menores registrados
`sourceRevision` de ambos eventos anterior a las correcciones finales de texto (nota en sus reportes; no se reescriben); `275f687` rojo en el spec pg hasta `29505f2`; comentario obsoleto del spec pg (limpiado); `IDEA-018`.

## Deudas y verificaciones pendientes del agente principal
Migraciones `20261009130000`, `140000`, `150000`, `160000`, `170000`, `180000` y `190000` sin aplicar a una base real y verificación con Postgres/pgvector real; `IDEA-017` (duraciones por repetición con `0`); residuos de `IDEA-016`; `runnerHint` `string | null` en §6.16 y estrechado en el DTO hasta `WI-CORE-028`; `modelVersion` siempre `null`; `$queryRaw` con funciones `void` sin lint.

## Estado posterior
La serie PHP (`WI-CORE-028`, `013`, `008`, `029`) sigue EN PAUSA por decisión del usuario y no se selecciona; `WI-CORE-004` espera al usuario.
