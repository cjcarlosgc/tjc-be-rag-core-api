# WI-CORE-033 — Revisión independiente (ciclo 1 de 2, Modo fuera de casa)

Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Alcance:** rama `integration/php-core-pr13`, `e5da9ff..2c12bd8` (merge `b8a0970` del PR #13 + 5 commits propios). **Veredicto: APPROVED** (sin blockers ni importantes; 8 menores). No sustituye decisiones `DEC` ni la aprobación del usuario para fusionar en `feature/jean` y publicar. Revisor independiente del implementer (Haiku 5.5) y de la autoría del PR.

## Lo ejecutado (en worktrees desechables, ya borrados)

| Gate | Resultado |
|---|---|
| prisma generate / lint / `nest build` | 0 / 0 / 0 |
| `tsc -p tsconfig.json` | 43 errores, el mismo conjunto exacto que `e5da9ff` (diff vacío); `tsconfig.build.json` 0 |
| vitest x2 | 134 archivos pasan, 6 omitidos; 2067 pasan, 104 omitidos (ambas corridas) |
| e2e x2 (`.env.example`, DB inalcanzable) | 7 archivos, 246 pasan (ambas) |
| `validate-harness.mjs`, `node --test harness/*.test.mjs` | 0; 29/29 |
| specs pg (jobs, retrieval-comparisons, analysis-trace, evidence, evidence-persistence-migration, context-traces) | 6 archivos, 104/104, en PostgreSQL desechable (puerto 58733) con las 45 migraciones de la rama (shim de pgvector solo en la copia; bajado y borrado) |
| compilación por commit (`tsconfig.build.json`: 0; `tsconfig.json`: 43) | `e5da9ff`, `b8a0970`, `9b2412d`, `a7c04ce`, `19b5002`, `7236138`, `2c12bd8` |
| Contract Sync `check` (sin `--record`) de WI-CORE-033 en sus 4 checkpoints | idéntico a lo registrado en `state.json` (salvo `checkedAt`) |

## 1. Integridad de la fusión

- `origin/feature/php-core` es ancestro de `HEAD`; 28 commits `777f6bc..php-core` con hash intacto. Sin marcadores de conflicto.
- Comparación mecánica por archivo (conjunto y multiconjunto de líneas `+/-`): para cada archivo tocado por ambos lados, `diff(777f6bc..e5da9ff) ∪ diff(777f6bc..php-core)` equivale a `diff(777f6bc..HEAD)`. En `CHANGELOG`, `experiment-job.handler(.spec)`, `experiments.service(.spec)`, `experiment-runs.repository`, `sandbox-execution.service(.spec)`, `sandbox.types`, `analysis-run-validation-job.handler.spec`: 0 hunks perdidos y 0 sobrantes. Residuos explicados: `map-sandbox-result(.spec)` (+1/+12 líneas: comentario y completado de fixtures), `analysis-run-validation-job.handler.ts` (`generation`/`llmResult` por la captura de evidencia 027, esperado), CS-014/015 (las 13 líneas «faltantes» son el contenido del PR, movido a `-016`/`-017`), `work-items.json` e INTEROP (reescrituras de texto declaradas). No hay hunks nuestros perdidos ni del PR sin integrar.

## 2. Conflictos (9)

`map-sandbox-result.ts`: correcto. `failureKind: ERROR` solo gana con `compiled && executed`; categoría validada contra enum sin `NONE` (`NONE`→`UNKNOWN`); `errorSummary` saneado en las dos ramas. `analysis-run-validation-job.handler.ts`: flujo PHP + `llmResult`/`generation`/`contextId`; HELD sin `<?php` conserva `generation` y `contextId` (código correcto; ver M6). `experiment-job.handler.ts`: `RepetitionEvidence` y `toRetrievalTarget` conviven; sin duplicados. CS-014/015 conservados byte a byte; CHANGELOG sin la copia obsoleta de 026.

## 3. Seguridad del código PHP

- **Ruta de salida (`php-test-path.ts`).** Probado con datos hostiles: `filePath` con `..` produce `tests/Unit/../../etc/AMTest.php`; ruta absoluta pierde la barra inicial (`tests/Unit/etc/...`); `\` se descarta; caracteres de control pasan a ruta y namespace; nombre vacío da `Test.php`; directorios con `-` dan namespace PHP inválido; `foo_bar` y `fooBar` colisionan en la misma ruta (la unicidad es por `(analysisRunId, analysisSymbolId)`, no por ruta). No hay guarda en `phpTestLocation`. **No es explotable hoy**: Core no escribe esa ruta en disco (la envía como `relativePath` del artefacto y solo hace `existsSync` de lectura); `filePath` sale de `listSafeZipEntries` (rechaza `..`, `/`, `C:`, `\..`) o del árbol de git; los nombres vienen del identificador tree-sitter; y el Sandbox rechaza `INVALID_ARTIFACT_PATH` (§7.4). Ver M1.
- **`sanitizeGeneratedPhp`.** Sin `<?php` → `null` (HELD / INVALID-COMPILATION, sin Sandbox); fences retirados; BOM retirado; texto fuera de fences → `null`; múltiples bloques y `system()` pasan (el aislamiento es del Sandbox; el artefacto va a una ruta fija). Regex lineal (sin ReDoS).
- **Extractor tree-sitter (`php-behavior-fingerprint.ts`, `workspace-agent-tools.ts`).** `hasError` → `[]`/`null`; árbol y parser se liberan en `finally`; `descendantsOf` es iterativo; `serializeNode` es recursivo pero dentro de `try/catch` (un desbordamiento devuelve `[]`). Sin tope de tamaño propio (lo acota el límite del ZIP). Sin hallazgo.
- **`app/scripts/local-php-env.mjs` y `app/README.md`.** Sin secretos en el repo (tokens con `randomBytes`, secretos externos en blanco); `.env` y `.env.*` ignorados; no sobrescribe `.env` sin `--force`; modo 0600; solo escribe `<root>/tjc-*/app/.env[.local-php]` si existe `.env.example` allí. Observaciones en M7.

## 4. Contrato

INTEROP fusionado coherente: §6.5 (PHP admitido, `422` solo sin `JEST`/`VITEST`/`PHPUNIT`, tasas `null` y contadores 027), §6.15 (sin 422 PHP, cinco relaciones), §6.16, §7 (`failureKind`, `phase`, códigos), `RagMatchedVia`/`structuralMatch`, líneas 5/14/334/1050/1470 corregidas (`a7c04ce`). Sin referencias residuales a «422 PHP» en experimentos. `CS-CORE-20261009-014/-015` byte a byte iguales a `e5da9ff`; `-016/-017/-018` iguales a los del PR salvo la línea `id`; IDs únicos y consecutivos. Observaciones del leader confirmadas como reales y de gravedad **menor** (M3): `-016` con `targets: [console, sandbox]` y `requiredAction` solo Console; `-017` aún afirma «experimentos siguen con 422 PHP» (superado por `-018`); `sourceRevision` cortos (`123f8ed`, `8f4ddd1`, `c1343cf`) frente a los 40 caracteres de 010..015 (no los rechaza el validador). `CS-SANDBOX-20261009-001` en JSON no importable: nota, sin bloqueo.

## 5. Evidencia 027 con PHP

`runnerHint` `PHPUNIT` se emite en `sandbox[]` (ANALYSIS_RUN y EXPERIMENT), los hechos conservan las 14 claves cerradas y los datos hostiles (`failureKind`, `phase`, `stdout`, `stderr`, `namespace`, `excerpt`, `composerLock`, `SECRET_*`) no aparecen ni como clave ni como valor. Mutaciones (todas en worktree desechable; spec afectado en 0 salvo M6):

| Mutación | Resultado |
|---|---|
| Quitar `PHPUNIT` del filtro de `sandbox-evidence-facts.ts` | falla 1 prueba |
| Quitar `PHPUNIT` de `RUNNER_HINTS` (evidence-mapping) | fallan 4 pruebas |
| Exponer `excerpt`/`namespace` en `toRagCandidates` | fallan 5 (esquema estable, claves y valores prohibidos) |
| Exponer `failureKind`/`stdout`/`stderr` en `toEvidenceFacts` | fallan 6 |
| `ASSERTION` gana sobre `ERROR` en `mapSandboxResult` | falla 1 |
| Quitar el saneado de `errorSummary` | fallan 3 |
| `failure.category` sin validar contra enum | fallan 3 (incluye `NONE`) |
| `sanitizeGeneratedPhp` sin exigir `<?php` | fallan 5 |
| `isSafeRelativePath` → `true` (guarda de rutas del agente, preexistente) | **no falla ninguna prueba** (M5) |
| Quitar `generation`/`contextId` de la propuesta HELD sin `<?php` | **no falla ninguna prueba** (M6) |

## 6. Cierre de WIs

013, 032, 028 y 029 están `W-DONE`, con `leader` `servedModel: claude-opus-5-5` (el leader original, no nosotros), los implementers `claude-haiku-5-5` tal como declaran sus reportes (coinciden con los trailers `Co-Authored-By`), `human-reviewer` APPROVED tomado de sus reportes (2026-10-09, sin `executedBy`), y el handoff de `contract-reviewer` de 013/028/029 proveniente de `wi-core-033-contract-review.md`. Los checkpoints de Contract Sync reproducen exactamente la salida real de `contract-sync.mjs check` (verificado para 033; los de 013/032/028/029 siguen la misma regla: `resolvedSyncIds` = eventos GH `C-RESOLVED`, `notRelevant` = los dos eventos revisados). WI-CORE-033 en `W-IN_REVIEW`, `reviewAgent: reviewer`, `reviewCycles: 0`, `independentReviewPassed: G-NOT_RUN`. No se atribuye al leader actual trabajo del PR. Afirmaciones **no verificables** por mí: la aprobación del usuario de DEC-PHP-GEN-001/-002 y el «levantó el diferimiento» (solo lo declara el reporte del PR); ver M2.

## 8–9. Migraciones, secretos e higiene

Sin cambios en `app/prisma` ni en `schema.prisma` en `e5da9ff..HEAD` ni en el PR. Barrido de secretos (diff neto y `git log -p` de los 34 commits) con patrones Stripe/OpenAI/GitHub/AWS/Slack/PEM/JWT/URL con credenciales: **0** coincidencias de forma bloqueable por GitHub; solo el ejemplo local `rag_core:rag_core@localhost:5433` del README (coincide con `docker-compose.yml`). Sin `.env`, dumps ni binarios nuevos. Los 34 commits traen `Refs: HU...`; los propios, `Co-Authored-By`. El árbol de `wt-php` tiene `app/node_modules` como symlink sin trackear (no commitear con `add -A`). Worktrees y ramas de esta revisión: ninguno sobrante.

## Hallazgos (todos menores; ninguno bloquea)

- **M1.** `app/src/generation/php-test-path.ts:36-68`: sin guarda de ruta (`..`, control, segmentos no identificador) ni prueba de rutas hostiles; hoy inalcanzable por guardas upstream y por `INVALID_ARTIFACT_PATH` del Sandbox. Recomendado: rechazar o normalizar `..`/control y sanear segmentos de namespace, con pruebas (la colisión `foo_bar`/`fooBar` solo se evita con sufijo si la ruta ya existe en el snapshot).
- **M2.** `spec/features/018-php-laravel-support/spec.md:52,54` y el encabezado de `php-test-path.ts` siguen marcando DEC-PHP-GEN-001/-002 como «PROPUESTA» y `spec.md:3` dice «generación PHPUnit queda planificada»; el reporte 013 afirma aprobación del usuario y `state.json` los lista como no bloqueantes. El usuario debe confirmar y consolidar el estado (spec + CHANGELOG).
- **M3.** Contract Sync `-016` (targets sin acción para `sandbox`), `-017` (texto superado por `-018`), `sourceRevision` cortos: ver sección 4. Reportes 028/029/013 del PR editados solo en los IDs; `wi-core-013-implementation.md:43` ahora dice que `-016` «se emitió en feature/php-core» (falso: ahí fue `-014`).
- **M4.** `spec/features/008-experimental-comparison/plan.md:52` aún dice `runnerHint = JEST|VITEST`; `wi-core-033-php-integration.md` habla de «46 migraciones» (son 45 directorios + `migration_lock.toml`).
- **M5.** `isSafeRelativePath` (`experiment-job.handler.ts:1428`, preexistente) sin cobertura: la mutación sobrevive.
- **M6.** La conservación de `generation`/`contextId` en la propuesta HELD sin `<?php` (`analysis-run-validation-job.handler.ts`, resolución de conflicto declarada en el reporte) no tiene prueba: `analysis-run-validation-job.handler.spec.ts:338-362` usa `objectContaining` sin esos campos.
- **M7.** `local-php-env.mjs`: `--force` sobrescribe `.env` de repos hermanos sin respaldo; `--podman` fija `SANDBOX_CONTAINER_USER=root`; imprime el webhook secret en stdout (documentado). Solo desarrollo local.
- **M8.** Pendientes declarados: prueba extremo a extremo PHP con Sandbox real, migraciones sobre base real, Sandbox publicado sin `phase`/`failureKind`; espejos Console/GitHub Integration de INTEROP-2.7.

## Siguiente paso

Mostrar al usuario el diff `e5da9ff..2c12bd8` y este reporte; el usuario decide la fusión en `feature/jean` (y confirma M2). Cerrar WI-CORE-033 a `W-DONE` solo tras ese veredicto. Reviewer: sin push, commit ni PR.
