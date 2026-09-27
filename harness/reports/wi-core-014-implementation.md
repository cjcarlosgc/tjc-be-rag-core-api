# Implementación contractual — WI-CORE-014

**Fecha:** 2026-09-27 16:30 America/Lima
**WI/ST/HU:** WI-CORE-014 / ST-CORE-021 / HU02, HU14
**Alcance:** cambio documental canónico; no modifica `app/`, APIs públicas Core, Sandbox ni configuración externa.

## Cambio aplicado

- `GH-INTEROP-1.2` agrega `pullRequest.createdAt` al webhook normalizado. Integration deriva la fecha únicamente de `pull_request.created_at`, la normaliza a ISO-8601 UTC y entrega `null` cuando falta o no es verificable. `receivedAt` conserva la hora de recepción.
- `pull-request-head` devuelve `createdAt` solo en una respuesta `OK` verificable; una fecha ausente, inválida o ambigua produce `UNVERIFIABLE` sin `value`.
- Core no sustituye la fecha con `receivedAt`, no crea ni reinicia un Run elegible cuando la fecha es `null`, mantiene ocultos los Runs afectados y reintenta la clasificación durablemente.
- Se actualizaron la spec de la feature 013, su plan/tareas, referencias contractuales vigentes, roadmap y `CHANGELOG.md`. `SYSTEM-2.5` e `INTEROP-2.6` mantienen su versionado.
- El plan establece una secuencia sin ciclo: Core publica la versión canónica; GH implementa y publica su entrega; Core-011 clasifica Runs; Console sincroniza después.

## Verificaciones

- `node scripts/sdd-check.mjs` — PASS (`SDD check OK`).
- `node harness/validate-work-items.mjs` — PASS (CORE, 14 WI).
- `node harness/validate-harness.mjs` — PASS (`Harness V3 validation passed`).
- `git diff --check` — PASS.
- No se ejecutaron lint, tests ni build de aplicación: este corte solo modifica SDD y Harness, no hay código de producto que compilar o probar.

El Contract Sync saliente a GitHub Integration y Console se publica tras registrar el commit que contiene esta versión canónica. No implica importación/ACK de los consumidores, implementación del servicio ni despliegue.
