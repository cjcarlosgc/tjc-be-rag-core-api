# WI-CORE-033 — Integración del PR #13 (PHP/PHPUnit) en feature/jean
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-10. **Rama:** `integration/php-core-pr13` (desde `origin/feature/jean` `e5da9ff`), sin push ni merge a `feature/jean`. **Origen:** `origin/feature/php-core` (PR cjcarlosgc/tjc-be-rag-core-api#13, base `777f6bc`) con `WI-CORE-013`, `032`, `028` y `029`, implementados y revisados por otro leader (Claude Opus 5.5 según sus reportes) y otro desarrollador; esta integración no se los atribuye. Orden del usuario en chat de preparar la fusión en una rama aparte y revisarla antes de mostrársela.

## Commits del PR (28, hashes intactos; merge commit `b8a0970`)
`7855799` `e8aaa6b` `2439b4d` `c1343cf` `0fc67d1` `6b4594b` `fa0cafe` `798fe00` `fa1231a` `a429336` `8f4ddd1` `4fd7936` `bfd2503` `ff318b4` `60aa78a` `7e88337` `e62d42c` `c040f06` `a1625ff` `558be0b` `4062cbc` `c5acb6f` `c5abb01` `123f8ed` `0a63d79` `d3bb158` `bff15b4` `35865f4` 

## Commits propios de la integración
- `b8a0970` merge (conflictos resueltos + compilación mínima: DTO/mapeo de evidencia `PHPUNIT`, filtro de runner de los hechos del Sandbox y fixtures de `map-sandbox-result.spec.ts`).
- `9b2412d` test(evidence) con las pruebas de `PHPUNIT` (trailer Haiku 5.5).
- `a7c04ce` docs(spec) con las correcciones de texto del contract-reviewer al INTEROP fusionado.
- Registro del alcance de Contract Sync y cierre de `WI-CORE-013`, `032`, `028` y `029` (con la evidencia de sus reportes); alta de `WI-CORE-033`.

## Mapa de conflictos y resoluciones (9 archivos con conflicto)
| Archivo | Resolución y motivo |
|---|---|
| `harness/contract-sync/outbox/CS-CORE-20261009-014.yaml`, `-015.yaml` (add/add) | Se conservan los nuestros (evidencia y agregados, `WI-CORE-027`). Los del PR pasan a `-016` (WI-013, §7), `-017` (WI-028, relaciones PHP) y `-018` (WI-029, experimentos PHP): `id` actualizado y referencias en sus reportes y CHANGELOG; sus `sourceRevision` y contenido no se reescriben. |
| `CHANGELOG.md` | Nuestras entradas más las 4 de PHP (013, 032, 028, 029); se descarta la copia obsoleta de WI-CORE-026 «en revisión» del PR. |
| `app/src/sandbox/map-sandbox-result.ts` | `failureKind` (DEC-PHP-GEN-002: un caso `ERROR` gana y da `TEST_RUNTIME`) conviven con la validación de `failure.category` (UNKNOWN por defecto) y el saneado de `errorSummary` (WI-CORE-027-A). |
| `app/src/sandbox/map-sandbox-result.spec.ts` | Ambos bloques de pruebas; fixtures de `failureKind` completados con `requestId`/`correlationId`/`durationMs`. |
| `app/src/validation/analysis-run-validation-job.handler.ts` | Flujo PHP del PR (ubicación DEC-PHP-GEN-001, `sanitizeGeneratedPhp`, `PHPUNIT`) con nuestra captura de evidencia (`llmResult`, `generation`, `contextId`, registro best-effort); la propuesta HELD sin `<?php` conserva `generation` y `contextId`. |
| `app/src/experiments/experiment-job.handler.ts` y su spec | Se conservan `RepetitionEvidence` (nuestro) y `toRetrievalTarget` (PHP); en el spec, los describes de evidencia y fallo y el de PHP/PHPUnit (WI-029). |
| `spec/contracts/interoperability-contract.md` | §6.5: PHP admitido (WI-029; `422 UNSUPPORTED_PROJECT` solo sin framework `JEST`/`VITEST`/`PHPUNIT`) con nuestra semántica de agregados (`null`, contadores) y notas IDEA-015/017; §6.15 sin 422 por lenguaje y con las cinco relaciones; tipos de trazas con relaciones PHP; §7 con `failureKind`, `phase`, `TEST_COMPILATION_FAILED`, `IMAGE_UNAVAILABLE`; líneas de estado (14, §6.5.1, §8) actualizadas por el contract-reviewer. |

Sin conflicto textual pero revisados: `experiments.service(.spec)`, `experiment-runs.repository`, `sandbox-execution.service(.spec)`, `sandbox.types`, `work-items.json` (auto-fusión correcta; los 4 WIs del PR no tenían estado de cierre).

## Cierre registrado de los WIs del PR
`WI-CORE-013`, `032`, `028` y `029` pasan a `W-DONE` con `executedBy` del leader original (servido `claude-opus-5-5`) y del implementer de cada reporte; el `human-reviewer` APPROVED es el de sus reportes de implementación (2026-10-09). Para 013, 028 y 029 (`contractImpact` true) sus revisiones no traían contract-reviewer: lo aporta la ratificación del INTEROP fusionado (`wi-core-033-contract-review.md`, APPROVED con correcciones de texto aplicadas). Los cuatro checkpoints de Contract Sync de cada uno se corrieron de verdad con `--record` durante la integración.

## Evidencia (rama de integración, HEAD tras el merge)
- `prisma generate` 0; lint 0; build 0; `tsc --noEmit` 43 (base 43; cada commit propio compila con `tsc -p tsconfig.build.json`).
- `vitest` completo: 134 archivos pasan / 6 omitidos; 2067 pasan, 104 omitidos (base de feature/jean 1984; PR 1762).
- e2e (variables de `.env.example`, DB inalcanzable): 7 archivos, 246 pasan.
- Specs pg (6 archivos) en PostgreSQL 14 desechable con las 45 migraciones (directorios) más `migration_lock.toml` (shim de pgvector solo en la copia): 104/104; el desechable se bajó y borró.
- `validate-harness` pasa; `harness/*.test.mjs` 29/29.

## Deudas y observaciones
- `CS-CORE-20261009-016` tiene `targets: [console, sandbox]` pero su `requiredAction` solo habla de Console, y el `-017` aún dice que los experimentos siguen con 422 PHP (superado por `-018`): observaciones del contract-reviewer; no se reescribe el contenido de eventos del PR (decisión del dueño).
- `CS-SANDBOX-20261009-001` sigue en JSON (harness V2 del Sandbox) y no es importable por Core V3; su contenido está en INTEROP §7.
- `sourceRevision` cortos en `-016..-018` (el README pide SHA completo): no se reescriben.
- Console y GitHub Integration deben espejar INTEROP-2.7 (`-016`..`-018` y `-014`/`-015`); el Sandbox publicado aún debe implementar `phase`/`failureKind`.
- Migraciones sin aplicar a una base real (las de feature/jean hasta `20261009190000`) y verificación con Postgres/pgvector real: a cargo del agente principal.
- No se hizo prueba extremo a extremo PHP con el Sandbox real (ver README del PR); es verificación pendiente del agente principal.

## Revisión independiente y cierre (2026-10-10)
- `reviewer` (Modo fuera de casa): APPROVED, ciclo 1 de 2, 0 blockers y 8 menores (`wi-core-033-independent-review.md`).
- Decisión del usuario en chat sobre las decisiones PHP: «Las decisiones relacionadas a php son mandatorias las de mi compañero, todas siempre y cuando no reviertan decisiones que ya tomamos». Verificación explícita de que ninguna revierte una anterior: `DEC-RC-001` (el 422 `UNSUPPORTED_PROJECT` por PHP en la comparación OE2 se retiraba con `WI-CORE-028` y en experimentos con `WI-CORE-029`, y sigue para PHP sin PHPUnit), `DEC-EVID-001` a `007` (tasas `null` y contadores conviven), `DEC-TRACE-001`/`002`, `DEC-JOBS-001`/`002`, `DEC-FK-003`/`004` (`WI-CORE-032` replica con paridad). `DEC-PHP-GEN-002` extiende la clasificación con `failureKind` sin revertir la regla previa cuando falta. Consolidadas como APROBADAS el 2026-10-10 (`33c820a`).
- Menores: M2 (consolidación, hecha), M3 y M4 (corregidos en `33c820a`), M1, M5 y M6 (registrados como `IDEA-019`, `IDEA-020` e `IDEA-021`, sin tocar código antes de publicar; el encabezado de `php-test-path.ts` que aún dice «PROPUESTA» queda en `IDEA-019`), M7 (`local-php-env.mjs`, solo desarrollo local: `--force` sobrescribe `.env` hermanos sin respaldo; `--podman` fija `SANDBOX_CONTAINER_USER=root`) y M8 (pendientes declarados) como deuda. Observaciones de `CS-CORE-20261009-016` (targets `[console, sandbox]` con `requiredAction` solo para Console) y `-017` (texto superado por `-018`) quedan registradas, sin reescribir YAML del PR.
