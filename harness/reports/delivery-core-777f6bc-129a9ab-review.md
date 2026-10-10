# Revisión de entrega — Core `777f6bc..129a9ab` (feature/jean)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto:** APPROVED (0 blockers, 0 importantes, 8 menores)
**Rango revisado:** `777f6bc..129a9ab` (39 commits; `129a9ab` = HEAD, árbol limpio; `origin/feature/jean` = `777f6bc`)
**Historias:** HU12, HU15, HU17
**Tipo:** entrega extraordinaria (no cierre de sprint), por orden explícita del usuario; Modo fuera de casa activo. Esta revisión no sustituye decisiones `DEC` ni aprobaciones de alcance o contrato, y no hace push, PR ni infraestructura externa.
**Revisor:** agente `reviewer`, independiente de los implementers (Haiku 5.5) y del leader. No editó código, spec ni harness; solo creó este archivo (sin commitear).

Rango listo para publicar: `777f6bc..129a9ab`. El único commit que debe seguir es el exclusivo `docs(review)` con este reporte; cualquier otra diferencia posterior exige nueva revisión completa (`harness/roles/reviewer.md`).

## 1. Inventario del rango

Todos los commits declaran `Refs:` y `Co-Authored-By` del modelo real (Haiku 5.5 en los 11 commits `feat`/`fix` de código; Sonnet 5.5 en docs y en los dos cambios del leader). Ningún SHA citado por un evento de Contract Sync fue reescrito (todos los `sourceRevision` existen en la historia).

| Grupo | Commits (orden cronológico) | Tipo | WI | HU |
|---|---|---|---|---|
| Cierre WI-CORE-026 | `bb0b501`, `2982f55` | docs(harness) | WI-CORE-026 | HU12, HU15 |
| WI-CORE-007 (selección, SDD, revisión, cierre) | `fee6c48`, `ee83cf5`, `a3bd704`, `b090cc5`, `890e8d4`, `dd3cf10`, `50408c3` | docs | WI-CORE-007 | HU12, HU17 |
| WI-CORE-007 (código) | `9ac7506` (corte A), `9618e6b` (corte B), `aa141ce` (fix de fugas y coste) | feat/feat/fix | WI-CORE-007 | HU12, HU17 |
| WI-CORE-027 (spec/harness/decisiones) | `6de3cf6`, `545274a`, `2c31348`, `8fb4aaf`, `52cff6b`, `3a23bbe`, `febd43c`, `b0984e0`, `2d203cb`, `4adf398`, `c96e1e8`, `eb5cdb7`, `6dc5d1b`, `46dc3b4`, `3f06f44`, `5fdfd3c`, `129a9ab` | docs(spec/harness) | WI-CORE-027 | HU12, HU15, HU17 |
| WI-CORE-027 (código) | `9293ef2` (A), `1cd66e8` (B), `32b4ebb`, `7b5f087`, `d17cd59` (C), `a5513a8` (E), `275f687` (F), `55e3ec9` (D) | feat/fix | WI-CORE-027 | HU12, HU15, HU17 |
| Cambio mínimo del leader | `29505f2` (test, 1 archivo, 1 línea) | test | WI-CORE-027 | HU12, HU15, HU17 |
| Harness (Modo fuera de casa) | `dd7741f` | docs(harness) | transversal (declarado bajo WI-CORE-027) | HU12, HU15, HU17 |

Los 11 commits de código tocan solo `app/` (0 documentos mezclados). Mezcla señalada: `5fdfd3c` (docs de revisión + 2 líneas de comentario en `app/src/evidence/persistence/evidence.repository.pg.spec.ts`), declarada en su asunto; ver hallazgo M3.

## 2. Cobertura de revisión

| Código | WI | Revisión independiente |
|---|---|---|
| `9ac7506`, `9618e6b` | WI-CORE-007 | ciclo 1 (`CHANGES_REQUESTED`) |
| `aa141ce` | WI-CORE-007 | ciclo 2 `APPROVED` (`dd3cf10`); sin cambios de `app/` entre `aa141ce` y esa aprobación ni después |
| `9293ef2`, `1cd66e8`, `32b4ebb`, `7b5f087`, `d17cd59`, `a5513a8`, `275f687`, `55e3ec9` | WI-CORE-027 | `APPROVED` ciclo 1 (`wi-core-027-independent-review.md`, rango `50408c3..3f06f44` en `app/`, 27 mutaciones detectadas) |
| `29505f2` | WI-CORE-027 | cambio mínimo del leader: 1 archivo, 1 línea, solo una expectativa de prueba (verificado con `git show`) |
| `5fdfd3c` (parte `app/`) | WI-CORE-027 | posterior a la aprobación; cambio mínimo del leader: 1 archivo, 2 líneas, solo comentario (verificado con `git show`) |

Cambios de `app/` posteriores a la aprobación de su WI: solo `5fdfd3c` (comentario). Ningún commit de producto sin WI aprobado. `a5513a8` corrige código de WI-CORE-026 ya aprobado, pero dentro de WI-CORE-027 y revisado en su sección (e). Las revisiones de WI-CORE-026 (ciclo 2) y WI-CORE-007 (ciclo 2) fueron delegadas por el usuario; la de WI-CORE-027, por el Modo fuera de casa.

## 3. Gates sobre HEAD `129a9ab` (ejecutados, `DATABASE_URL`/`DIRECT_URL` inalcanzables)

| Verificación | Resultado |
|---|---|
| `pnpm lint` (app/) | exit 0 |
| `pnpm test` x2 | 132 files passed / 6 skipped; 1984 passed / 104 skipped (2088); ambas corridas idénticas |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` x2 | 7 files, 246 passed, ambas corridas |
| `npx tsc --noEmit -p tsconfig.json` (cliente regenerado) | 43 errores (= base `777f6bc`, 43) |
| `npx tsc --noEmit -p tsconfig.build.json` | 0 errores |
| `node harness/validate-harness.mjs` | `Harness V3 validation passed.` |
| `node --test harness/*.test.mjs` | 29/29 passed |
| Specs pg (jobs, retrieval-comparisons, analysis-trace, evidence, evidence-persistence-migration, context-traces) | 7 files, 112/112 passed, sin omitidos, contra PostgreSQL 14 desechable (puerto 54329, solo scratchpad) con las 45 migraciones aplicadas |

Nota: el árbol `prisma/migrations` tiene 45 migraciones (46 entradas contando `migration_lock.toml`); las 45 aplicaron en orden. El shim de pgvector se aplicó solo a una copia (`vector(1536)` -> `float8[]`, sin HNSW, `DROP INDEX IF EXISTS` en `20260831063330`); la base se bajó y se borró.

## 4. Compilación por commit

Worktree desechable con `prisma generate` por commit (ya eliminado). `tsc -p tsconfig.build.json` = 0 errores y `tsc -p tsconfig.json` = 43 en cada uno de: `777f6bc`, `9ac7506`, `9618e6b`, `aa141ce`, `9293ef2`, `1cd66e8`, `32b4ebb`, `7b5f087`, `d17cd59`, `a5513a8`, `275f687`, `29505f2`, `55e3ec9`, `5fdfd3c`, `129a9ab`. Es decir, todos los commits que tocan `app/` (los 11 de código, `29505f2` y `5fdfd3c`); sin regresión de tsc. No se ejecutó la batería de pruebas por commit (solo compilación); el rojo de `275f687` en el spec pg ya lo documentó la revisión de WI-CORE-027 (M2).

## 5. Migraciones

- Nuevas desde `777f6bc`: `20261009180000_experiment_repetition_failure` y `20261009190000_evidence_persistence`; ambas `A` (añadidas), ninguna migración publicada editada (`git diff --name-status`: solo 2 `A`), orden por marca de tiempo posterior a `20261009170000`.
- Aditivas: solo `ADD COLUMN` nullable (1 + 11 columnas) y 2 `CHECK` (`durationMs >= 0`; `artifactHash IS NULL OR ~ '^[0-9a-f]{64}$'`); sin backfill, sin tablas nuevas (RLS ya vigente). Rollback manual documentado en el encabezado de ambas.
- `prisma migrate diff --from-schema <schema de 777f6bc> --to-schema prisma/schema.prisma`: exactamente las 12 columnas de las dos migraciones. `--from-config-datasource` (base desechable) contra el schema actual: sin diferencia en ninguna columna nueva ni en los CHECK; solo `embedding` (efecto del shim) y renombres/tipos preexistentes de `context_traces`, `discovered_files` e índices de `experiment_repetitions` (los mismos que ya reportaron las revisiones de 007 y 027; no introducidos por este rango).
- No se aplicaron a una base real (Supabase/producción); deuda registrada (ver 8).

## 6. Seguridad y secretos

- `git diff` del rango y archivos nuevos revisados con patrones de claves, tokens, PEM, JWT, URLs con credenciales y hosts de Supabase/Render: solo fixtures sintéticos de las pruebas del saneador (`hunter2`, `AKIAIOSFODNN7EXAMPLE`, `ghp_0123456789abcdefABCDEF`, `user:pass@h.example`, `postgresql://user:secret@host`, `postgresql://postgres@127.0.0.1:55440/...` en comentarios de uso). Sin claves reales, URLs de base reales, `.env` ni dumps en el rango.
- `app/.env` está ignorado (`.gitignore:6`) y no versionado; `app/dist` y `app/src/generated` ignorados. `git ls-files` no contiene dumps ni backups fuera de `migrations/`/`preflight`/`validation` preexistentes (`.env.example` preexistente, sin cambios en el rango).
- Ningún reporte de harness del rango contiene valores secretos ni URLs reales.
- Advisory (M7): el spec del saneador usa la clave de ejemplo pública de la documentación de Stripe (una clave de ejemplo pública de Stripe con prefijo `sk_live_`).

## 7. Contract Sync

- Outbox: únicos eventos nuevos en el rango `CS-CORE-20261009-014` (evidencia §6.16, `275f687`) y `CS-CORE-20261009-015` (agregados §6.5/§6.5.1 por DEC-EVID-001, `55e3ec9`); ambos `A` (añadidos), `C-PENDING`, `breaking: true`, destino Console, `sourceWorkItem: WI-CORE-027`, con reporte de publicación. `-012` (WI-CORE-026 -> github-integration) y `-013` (-> Console) ya estaban publicados en `777f6bc`, sin modificar, `C-PENDING`. Todos los `sourceRevision` del outbox existen en la historia (la única referencia no resoluble es el id histórico `CS-20260924-001`, anterior al rango).
- Cambios de contrato en el rango: `2d203cb` (congela §6.16 -> CS-014), `c96e1e8` (Implementado en §6.16 y §6.5 -> CS-014/CS-015), `3f06f44` (precisión textual de comentarios de medias y la excepción de IDEA-017; mismos tipos TypeScript, sin efecto de DTO). Ningún cambio de forma de DTO ni de ruta queda sin evento; `3f06f44` se cubre con notas en los reportes de publicación (M1). Sin eventos duplicados ni reescritos. `GH-INTEROP` no cambia en el rango (el `checkId` de WI-CORE-026 va por `-012`, ya publicado).
- Los eventos de WI-CORE-026 y -027 coinciden con el INTEROP-2.7 vigente (`StrategyMetricsResponse`, `EvidenceBundleResponse`, rutas `/evidence`).

## 8. Consistencia del harness

- `state.json`: `activeWorkItem: null`; `completedWorkItems` incluye WI-CORE-026 (`reviewCycles` 1; ver M8), WI-CORE-007 (2) y WI-CORE-027 (1) con `closedAt`, `gateEvidence` y `decisionGate`; todo WI `W-DONE` de `work-items.json` figura en `completedWorkItems`. `awayMode` bien formado: `enabled: true`, `activatedBy: "user"`, `activatedAt`, `quote`; sin campos de desactivación.
- `work-items.json`, `tasks.md` (ST-CORE-007, -033, -034 en `[x] T-DONE`) y `progress/current.md` coinciden en el estado de cierre; sin WI abierto huérfano (WI-CORE-004/008/013/028/029 en `W-PLANNED`, 005 `W-CANCELLED`).
- Deudas registradas: IDEA-013 a IDEA-018 en `spec/ideas.md`; residuos (migraciones `…130000` a `…190000` sin aplicar a una base real y sin verificación con pgvector real, `modelVersion` siempre `null`, `runnerHint` estrechado hasta WI-CORE-028, `$queryRaw` con funciones `void`) en el cierre de WI-CORE-027.
- `harness/validate-harness.mjs` y `harness/*.test.mjs` verdes (ver 3).

## 9. Alcance

- Todo lo implementado deriva de decisiones aprobadas por el usuario (DEC-TRACE-001/002 en WI-CORE-026; confirmación de alcance de WI-CORE-007 en chat; DEC-EVID-001 a DEC-EVID-007 y alcance adicional del corte E en WI-CORE-027), todas `nonBlocking` y cerradas en `decisionGate`.
- PHP (028/013/008/029) no tocado: sin cambios de spec ni tareas de esos WI; las únicas referencias a PHP en `app/` son valores de enum (`PHPUNIT`, `PHP_LARAVEL_PHPUNIT`) pasados a través del bundle de evidencia y el comentario que remite a WI-CORE-028. Sandbox y Console no se modifican (el rango solo toca este repositorio; todo cambio de contrato va por Contract Sync).
- El Modo fuera de casa no se usó para sustituir decisiones DEC ni alcance: no hay aparcados ni `DECISION_REQUIRED` abiertos.

## Hallazgos (todos menores; ninguno bloquea la publicación)

- **M1 — `sourceRevision` de CS-014/CS-015 anterior a las correcciones finales de texto.** `harness/contract-sync/outbox/CS-CORE-20261009-014.yaml:12` (`275f687`) y `CS-CORE-20261009-015.yaml:12` (`55e3ec9`) apuntan a revisiones previas a `3f06f44`. La nota para Console («tomar §6.16/§6.5 de `3f06f44` o posterior») vive solo en `harness/reports/contract-sync-publish-cs-core-20261009-014.md` y `-015.md`, no en el YAML. Escenario: Console importa el evento y lee §6.5 como «null si evaluableRepetitions = 0» para las medias de generación/total; los tipos no cambian. No se reescribe el evento (README de Contract Sync). Recomendación: al coordinar el handoff a Console, citar `3f06f44` o posterior explícitamente.
- **M2 — `275f687` deja roja una expectativa del spec pg hasta `29505f2`.** `app/src/evidence/persistence/evidence.repository.pg.spec.ts:207` (`durationMs: null` frente a `200`); los gates por defecto no lo ven (spec omitido sin URL). Solo afecta a `git bisect` con specs pg; HEAD verde. Ya registrado en `wi-core-027-implementation.md`.
- **M3 — `5fdfd3c` mezcla docs con una limpieza de comentario en `app/`.** Cumple «cambio mínimo» (1 archivo, 2 líneas, solo comentario, sin lógica) y está declarado en el asunto; la política prefiere commits por tema, pero no hay riesgo funcional.
- **M4 — Estado de texto desactualizado.** `CHANGELOG.md` mantiene «(en revisión)» en las entradas de WI-CORE-026 y WI-CORE-027 ya cerradas y no tiene entrada de WI-CORE-007 (columna interna `failure`, sin contrato); `harness/progress/current.md` conserva en el párrafo de secuencia frases previas a los cierres («Siguiente tras su cierre: `WI-CORE-007`, `WI-CORE-026` y `WI-CORE-008`», «Siguen elegibles…», y «Al cerrar `WI-CORE-027` se levanta el diferimiento de `013`, `028` y `029`», que contradice la pausa PHP vigente declarada en la misma sección). El estado machine-readable (state/work-items/tasks) es correcto.
- **M5 — `awayMode.activatedAt` impreciso.** `harness/state.json`: `2026-10-09T00:00:00.000Z` (marca de medianoche) frente a la activación efectiva registrada en `dd7741f` (2026-10-09 21:53 -05). No afecta a validaciones.
- **M6 — IDEA-015/IDEA-016 con estado `I-BACKLOGGED` pese a «INCLUIDA»/«RESUELTA».** `spec/ideas.md:21-22`: el prefijo textual declara resolución en el corte A de WI-CORE-027 pero la columna de estado sigue `I-BACKLOGGED` (los residuos de IDEA-016 siguen listados). Incoherencia de registro, no de comportamiento.
- **M7 — Clave de ejemplo de Stripe en un spec.** `app/src/common/sanitize-failure-message.util.spec.ts:352,353,401`: una clave de ejemplo pública de Stripe (prefijos `sk_live_`, `sk_test_` y `rk_live_`) son los valores de ejemplo públicos de la documentación de Stripe, no secretos; pero el escáner de secretos o push protection de GitHub puede marcarlos al hacer push. Si el push se rechaza por ello, el remedio es construir el literal por concatenación en el spec (cambio de prueba que invalidaría esta aprobación y requeriría nueva revisión).

- **M8 — `reviewCycles` de WI-CORE-026 inconsistente con su informe.** `harness/state.json` registra `reviewCycles: 1` para WI-CORE-026, pero `harness/reports/wi-core-026-independent-review.md:90-92` y el cierre documentan `CHANGES_REQUESTED` y una segunda pasada `APPROVED` (ciclo 2), como en WI-CORE-007 (`reviewCycles: 2`). No excede `maxReviewCycles` ni afecta gates.

## Lo ejecutado frente a lo razonado

- Ejecutado: gates de la sección 3, compilación por commit de la sección 4, aplicación de migraciones y specs pg, `migrate diff`, barridos de secretos con `grep` sobre el diff del rango, verificación de `sourceRevision`, comparación de estados.
- Razonado, no ejecutado: la corrección funcional de cada WI se tomó de sus revisiones independientes (007 ciclo 2, 026 ciclo 2, 027 ciclo 1) sin repetirla; no se repitieron mutaciones. No se probó contra PostgreSQL 17 ni con pgvector real (PG 14 con shim); las migraciones no se aplicaron a una base real. No se ejecutó la batería completa por commit, solo compilación.

## Handoff

- `status`: APPROVED
- `blockers`: ninguno
- `filesAffected`: `harness/reports/delivery-core-777f6bc-129a9ab-review.md` (creado, sin commitear)
- `recommendedNextStep`: el leader commitea este archivo como commit exclusivo `docs(review)` (`Refs: HU12, HU15, HU17`); tras él, el diff adicional debe contener únicamente este reporte; luego push de `feature/jean` por orden explícita del usuario. Opcional antes del push: M4–M6 y M8 (documentos) invalidarían la aprobación del commit final exacto, por lo que conviene diferirlos al siguiente corte o a una nueva revisión.
