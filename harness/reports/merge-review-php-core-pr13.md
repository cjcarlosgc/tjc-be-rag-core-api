# Revisión de fusión — PR #13 (PHP/PHPUnit) hacia feature/jean
Modelo: merge-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-10. **Rama revisada:** `integration/php-core-pr13` (HEAD `eb3ea6b`, local, sin publicar). **Destino:** `origin/feature/jean` = `feature/jean` = `e5da9ff`. **Origen de terceros:** `origin/feature/php-core` (`7855799`, PR #13, base `777f6bc`).

**Veredicto: APPROVED** (0 blockers, 0 importantes, 4 menores). No sustituye la orden expresa del usuario para fusionar ni publicar.

## 1. Topología (ejecutado)
- `origin/feature/jean` (`e5da9ff`) y `origin/feature/php-core` (`7855799`) son ancestros de HEAD; `git rev-list HEAD..origin/feature/php-core` = 0.
- Los 28 commits de `777f6bc..origin/feature/php-core` están en HEAD con su hash (autor `jcmc-pe`, 28 de 28).
- `e5da9ff` es ancestro de HEAD: **fast-forward posible** desde `feature/jean`. Entrarían 38 commits: los 28 del PR, el merge `b8a0970` (padres `e5da9ff` y `7855799`; único merge del rango) y 9 propios (`9b2412d`, `a7c04ce`, `19b5002`, `7236138`, `2c12bd8`, `33c820a`, `3eb4788`, `c549b55`, `eb3ea6b`), todos de `cjcarlosgc`. Sin commits ajenos.
- Los 38 commits traen `Refs:` y `Co-Authored-By:`.
- `origin/feature/jean` en el remoto = `e5da9ff` (`git ls-remote`, solo lectura): la línea destino no avanzó. No existe `integration/*` en el remoto.

## 2. Hunks (ejecutado: multiconjunto de líneas por archivo)
Los 17 archivos tocados por ambos lados respecto de `777f6bc`: `CHANGELOG.md`, 5 de `experiments/`, 5 de `sandbox/`, 2 de `validation/`, CS-014/-015, `work-items.json`, `interoperability-contract.md`. Predicción = base + (propio − base) + (PR − base); se compara con HEAD. Sin marcadores de conflicto en el árbol (`git grep` de `<<<<<<<`, `=======`, `>>>>>>>`: 0).

| Archivo | Residuo | Explicación |
|---|---|---|
| 5 de `experiments/`, `sandbox-execution.service(.spec)`, `sandbox.types`, `analysis-run-validation-job.handler.spec` | ninguno | auto-fusión limpia |
| `map-sandbox-result.spec.ts` | +4 `requestId/correlationId/durationMs` | fixtures del PR completados con campos obligatorios de nuestro `SandboxExecutionResult` (compilación) |
| `map-sandbox-result.ts` | +1 comentario `WI-CORE-027 (IDEA-015, integración WI-CORE-013)` | resolución: `failureKind` convive con validación de categoría y saneado |
| `analysis-run-validation-job.handler.ts` | 6 líneas `generation.content` → `llmResult.content`, `generation,` | resolución: flujo PHP del PR con nuestra captura de evidencia; verificado el diff completo contra el PR |
| CS-014/-015 (outbox) | 28 líneas del PR | son el contenido de los avisos del PR, renumerados a -016 y -017 (ver 3) |
| `work-items.json` | estados y alta | 013/028/029/032 a `W-DONE` con `contractSyncReview`; WI-CORE-033 nuevo; 007/026/027 conservan `W-DONE` propio; ningún otro WI cambió (verificado a nivel JSON) |
| `CHANGELOG.md` | 3 entradas del PR reescritas | actualización de estado/renumeración de CS; +3 entradas nuevas (DEC PHP, merge-reviewer, WI-CORE-033) |
| `interoperability-contract.md` | 5 líneas reescritas | estado de implementación PHP (§1, §6.5, §6.5.1, §6.15, §8) y fecha de corte; de acuerdo con el reporte del contract-reviewer |

Además hay cambios manuales en el merge que solo tocó un lado (cc-diff): `evidence-bundle.response.ts`, `evidence-mapping.ts`, `sandbox-evidence-facts.ts` (`runnerHint` `PHPUNIT`, 4 hunks pequeños), documentados en el reporte de integración y cubiertos por pruebas en `9b2412d`.

## 3. Contract Sync (ejecutado)
- CS-014 y CS-015: **idénticos byte a byte** a `e5da9ff`.
- CS-016/-017/-018 = PR `-014/-015/-016` con solo la línea `id` distinta (`diff` tras `sed`): contenido, `sourceRevision`, `targets` intactos.
- 18 IDs únicos; en el rango solo se agregan 3 archivos de outbox, ninguno se modifica ni borra.
- `sourceRevision` de 014..018 existen y son ancestros de HEAD (`275f687`, `55e3ec9`, `123f8ed`, `8f4ddd1`, `c1343cf`).
- INTEROP-2.7 coherente: §1 y §8 declaran el consumo PHP; §6.5 admite PHP con 422 solo sin framework JEST/VITEST/PHPUNIT; §6.15 sin 422 por lenguaje y con cinco relaciones; `RagMatchedVia`/`structuralMatch` ampliados; §7 con `failureKind`, aclaración de `phase`, `TEST_COMPILATION_FAILED`, `IMAGE_UNAVAILABLE`; §6.16 intacto salvo `runnerHint` `PHPUNIT` en código. Las referencias de los reportes del PR (013/028/029) se renumeraron a 016/017/018.

## 4. Harness (ejecutado)
- `node harness/validate-harness.mjs`: pasa. `node --test harness/*.test.mjs`: 29/29.
- `state.json`: `activeWorkItem` null; `completedWorkItems` con 30 entradas sin duplicados y con 013, 032, 028, 029, 033 `W-DONE`; los cuatro WIs del PR atribuidos al leader original (`executedBy` servido `claude-opus-5-5`, configurado `claude-sonnet-5-5`) y al implementer del reporte; `awayMode.enabled: true` (registro del usuario, `activatedBy: user`); el diff contra `e5da9ff` son solo adiciones (1309+, 0 borradas).
- `tasks.md` (018, 004, 008), `CHANGELOG.md`, `progress/current.md` y `spec/features/018` consistentes con el estado de los WIs (ST-CORE-020/-035/-036/-039/-040 `T-DONE`).

## 5. Migraciones (ejecutado)
- `git diff --name-status e5da9ff HEAD -- app/prisma` vacío y `777f6bc..origin/feature/php-core -- app/prisma` vacío: ninguna migración añadida ni modificada; última `20261009190000_evidence_persistence`; 45 directorios + `migration_lock.toml`.
- `prisma migrate diff --from-schema <schema de e5da9ff> --to-schema <schema de HEAD>`: migración vacía.
- Aplicadas las 45 en orden sobre PostgreSQL desechable (shim `vector`→`float8[]` solo en copia): OK. `migrate diff` BD→`schema.prisma`: 23 líneas, idénticas a la deriva ya conocida (columna `embedding` del shim, `TIMESTAMP(3)` en 3 columnas, 2 nombres de FK y 2 de índice truncados): sin deriva nueva.

## 6. Gates sobre HEAD (ejecutado, worktree desechable propio)
| Gate | Resultado |
|---|---|
| `prisma generate` | 0 |
| `oxlint src/ test/` | 0 |
| `vitest run` (2 corridas) | 134 archivos pasan, 6 omitidos; 2067 pasan, 104 omitidos, ambas |
| `nest build` | 0 |
| e2e (variables de `.env.example`, `DATABASE_URL`/`DIRECT_URL` inalcanzables), 2 corridas | 7 archivos, 246 pasan, ambas |
| `tsc -p tsconfig.json` | 43 errores (= base 43) |
| `tsc -p tsconfig.build.json` | 0 |
| specs pg (jobs, retrieval-comparisons, analysis-trace, evidence, evidence-persistence-migration, context-traces) en PostgreSQL desechable (puerto 55497) | 6 archivos, 104/104 |
| Merge commit `b8a0970` (worktree desechable) | `tsc -p tsconfig.build.json` 0; `tsc -p tsconfig.json` 43 |

El único commit propio posterior a `b8a0970` que toca `app/` es `9b2412d` (specs), cubierto por los gates de HEAD. Los worktrees y la PostgreSQL desechables se bajaron y borraron.

## 7. Secretos y protección de GitHub (ejecutado)
Barrido de `git log -p -m e5da9ff..HEAD` y de `git diff e5da9ff HEAD` con patrones `sk_live_`, `sk_test_`, `rk_live_`, `sk-…`, `ghp_/gho_/ghs_/ghu_`, `github_pat_`, `AKIA`, `ASIA`, `xox*-`, PEM, JWT, `whsec_`, `AIza`, URLs con credenciales y archivos `.env`/`.pem`:
- **Líneas añadidas respecto de `e5da9ff`: 0 coincidencias.** Las coincidencias (unas 100 líneas) del `log -p -m` son del merge frente al padre del PR (contenido nuestro ya publicado en `e5da9ff`); ninguna de los 28 commits del PR ni de los 9 propios.
- Árbol de HEAD vs `e5da9ff`: 22 coincidencias en ambos (fixtures sintéticos del saneador; mismas líneas ya presentes en `origin/feature/jean`). Claves de Stripe contiguas con cuerpo de 8 o más caracteres en HEAD: 4 (misma cantidad que en `e5da9ff`): `sanitize-failure-message.util.spec.ts:393` (`task_live_…`, no es clave), `evidence-bundle.assembler.spec.ts:867` (`sk_live_abcdefgh12345678`, 16 caracteres, ya en `e5da9ff:756` y aceptada por GitHub al publicarse), y 2 menciones en reportes de entrega. Ninguna de las tres claves que el usuario permitió reaparece; **0 claves nuevas**.
- `app/scripts/local-php-env.mjs` genera tokens aleatorios en ejecución; sin literales. Línea de README con `rag_core:rag_core@localhost` (credencial de Docker local, no secreto).

## 8. Publicación y forma de integrar
- Nada se ha publicado: sin `integration/*` en el remoto, `origin/feature/jean` en `e5da9ff`, rama local `[ahead 38]`. Sin push, PR ni merge.
- Procede **fast-forward** (conserva el merge commit `b8a0970` y los 28 hashes). Tras la orden expresa del usuario, desde el árbol principal en `feature/jean`:
  `git merge --ff-only integration/php-core-pr13`
  y después, solo con orden de publicar: `git push origin feature/jean`. Reverificar antes que `origin/feature/jean` siga en `e5da9ff` (`git ls-remote origin feature/jean`); si avanzó, hay que rehacer la revisión de la fusión.

## Hallazgos
| ID | Severidad | Ubicación | Descripción |
|---|---|---|---|
| F1 | menor | `harness/reports/wi-core-013-implementation.md` (nota «Posible colisión de IDs») | La nota quedó con `-016` renumerado pero sigue describiendo una colisión ya resuelta; no confunde pero es histórica. |
| F2 | menor | `spec/contracts/interoperability-contract.md:5` | `Fecha de corte: 2026-10-09` aunque las DEC-PHP-GEN y la integración son de 2026-10-10 (la spec 018 sí lleva 10-10). Decisión de versionado del contrato. |
| F3 | menor | `harness/state.json` `awayMode` | Sigue `enabled: true`; la fusión y el push no dependen de él, pero debe desactivarlo el usuario cuando vuelva. |
| F4 | menor | `app/src/evidence/evidence-bundle.assembler.spec.ts:867` | Literal `sk_live_abcdefgh12345678` contiguo reaparece en un blob nuevo (modificado en `9b2412d`/`b8a0970`); idéntico al ya aceptado en `e5da9ff`. Bajo riesgo de bloqueo; mitigable partiéndolo como se hizo en `36f4817`. |

## Blockers
Ninguno.

## filesAffected
Solo este reporte (sin commitear): `harness/reports/merge-review-php-core-pr13.md` en el worktree `wt-php`.

## recommendedNextStep
Esperar la orden expresa del usuario; luego `git merge --ff-only integration/php-core-pr13` en `feature/jean` y, con orden aparte, `git push origin feature/jean`. Antes, confirmar con `git ls-remote origin feature/jean` que sigue en `e5da9ff`.
