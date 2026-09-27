# WI-CORE-011 — Evidencia de implementación

**Estado:** corte implementado; queda pendiente la revisión independiente humana. El WI permanece `W-IN_PROGRESS`; no se solicita ni se registra `W-DONE`.

## Alcance

Implementa `ST-CORE-017` y `ST-CORE-018` para `HU02`, `HU12` y `HU14`, con la dependencia `WI-GH-007` verificada. No modifica Console ni Sandbox y no incluye `WI-CORE-013`/PHP. No se aplicó la migración a ninguna base externa.

## Cambios observables

- Core conserva `pullRequestCreatedAt` y `repositoryBindingEligible` en Runs. Compara inclusivamente contra `RepositoryBinding.createdAt`; PRs anteriores no crean ni reinician Runs.
- La clasificación histórica es idempotente y transaccional. Los Runs pre-binding pasan a `OBSOLETE`; preguntas pendientes se invalidan en la misma transacción, mientras Runs, evidencia y relaciones permanecen almacenados.
- Listas, detalles/deep links e inbox filtran Runs sin clasificar y pre-binding antes de paginar.
- Fechas ausentes o no verificables se reintentan con un job deduplicado y backoff durable. Para un evento nuevo, el job conserva solo los campos normalizados allowlisted, no un Run provisional, y retoma el análisis solo tras verificar elegibilidad, binding habilitado y PR abierto con el mismo HEAD.
- Los eventos de cierre, conversión a borrador y cambio de base fuera de la rama de integración actualizan lifecycle aun cuando falte la fecha.
- `INTEROP-2.6`, SYSTEM-2.5, la feature 013 y el changelog registran la regla y su recuperación. El Contract Sync dirigido a Console queda pendiente de publicación tras este commit, con este commit como `sourceRevision`.

## Verificaciones ejecutadas

- Pruebas focalizadas del worker, webhook y filtros de alcance: **75 pasaron**.
- Suite completa desde `app/`: `./node_modules/.bin/vitest run` — **103 archivos pasaron, 1 omitido; 1,159 pruebas pasaron y 36 omitidas**.
- Lint: `./node_modules/.bin/oxlint src/ test/` — pasó.
- Build: `./node_modules/.bin/nest build` — pasó.
- Prisma: `./node_modules/.bin/prisma validate` — pasó.
- `node scripts/sdd-check.mjs` — pasó.
- `node harness/validate-work-items.mjs` — pasó.
- `node harness/validate-harness.mjs` — pasó.
- `node harness/validate-completions.mjs` — pasó.
- Contract Sync `start` — sin eventos relevantes pendientes; GH `CS-GH-20260927-001` está importado y reconocido.

## Límites y siguiente paso

La verificación local no aplica la migración ni valida contra una instancia PostgreSQL real. La revisión contractual especializada indicó que el espejo de Console necesita Contract Sync dirigido; no requiere cambios de UI. El usuario sigue siendo el reviewer independiente: revisar el diff, la migración y los resultados funcionales antes de permitir `W-DONE` o cualquier publicación.
