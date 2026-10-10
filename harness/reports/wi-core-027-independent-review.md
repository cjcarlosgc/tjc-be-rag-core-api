# WI-CORE-027 — Revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Fecha: 2026-10-10. Revisión por el agente `reviewer` bajo el «Modo fuera de casa» (`awayMode.enabled` en `harness/state.json`, activado por el usuario). El reviewer no implementó, corrigió ni commiteó nada; este archivo es lo único que creó en el árbol (sin commitear). Una corrida anterior se cortó por límite de uso sin informe; esta parte de cero.

- Rango de código: `git diff 50408c3..HEAD -- app` (cortes A `9293ef2`, B `1cd66e8`, C `32b4ebb`/`7b5f087`/`d17cd59`, E `a5513a8`, F `275f687`, D `55e3ec9`, cambio mínimo `29505f2`) y docs hasta `3f06f44` (HEAD). HU: HU12, HU15, HU17.
- Veredicto: **APPROVED** (0 blockers, 0 importantes, 4 menores). Ningún incumplimiento invalida un requisito; los menores no bloquean el cierre y se listan para que el leader decida si los corrige antes del push.
- Esta aprobación no sustituye ninguna decisión `DEC` ni la aprobación humana de alcance/contrato, y no autoriza push, PR ni infraestructura externa.

## Verificaciones ejecutadas (evidencia)

| Verificación | Resultado |
|---|---|
| `pnpm lint` (app/) | exit 0 |
| `pnpm test` x2 | 132 files passed / 6 skipped; 1984 passed / 104 skipped (2088), ambas corridas idénticas |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` x2 | 7 files, 246 passed, ambas corridas |
| `npx tsc --noEmit -p tsconfig.json` (cliente regenerado) | 43 errores, todos en specs/soporte preexistentes; mismo conjunto de archivos y códigos que la base `50408c3` (43) |
| `node harness/validate-harness.mjs` | `Harness V3 validation passed.` |
| `contract-sync.mjs check --checkpoint before-review --work-item WI-CORE-027` | `relevantPendingSyncIds: []`, `acknowledgedSyncIds: []`; no relevantes CS-20260920-001 y CS-20260921-003. No registró nada (`git status` limpio) |
| Compilación por commit (worktree desechable, `prisma generate` por commit) | `tsc -p tsconfig.build.json`: 0 errores y `tsc -p tsconfig.json`: 43 en `50408c3`, `9293ef2`, `1cd66e8`, `32b4ebb`, `7b5f087`, `d17cd59`, `a5513a8`, `275f687`, `55e3ec9`, `29505f2`, `3f06f44` (sin regresión) |
| PostgreSQL 14 desechable (127.0.0.1:55937, scratchpad, shim de pgvector solo en copia: `vector(1536)` -> `float8[]`, sin HNSW; bajado y borrado) | Las 45 migraciones aplican en orden, incluida `20261009190000`; columnas nullable, 2 CHECK presentes |
| `prisma migrate diff --from-config-datasource --to-schema` contra esa base | Solo `embedding` (efecto del shim) y los renombres/tipos preexistentes de `context_traces`, `discovered_files` e índices de `experiment_repetitions` (los mismos de 007); ninguna diferencia en las 11 columnas ni en los CHECK |
| Rollback documentado en el encabezado de la migración | Ejecutado en `BEGIN … ROLLBACK`: los 12 `ALTER` aplican; las 11 columnas y los 2 CHECK desaparecen (la única `failure` que queda es la de `20261009180000`) |
| Specs pg (evidence, analysis-trace, evidence-persistence-migration, context-traces, jobs, retrieval-comparisons) con sus `*_TEST_DATABASE_URL` | 6 files, 104/104 passed |
| e2e adicional en worktree sin `app/.env` (variables de `.env.example`, `DATABASE_URL` inalcanzable) | 7 files, 246 passed (los gates del árbol principal corrieron con `app/.env` presente, que el `ConfigModule` carga; `DATABASE_URL`/`DIRECT_URL` se sobrescribieron con la URL inalcanzable y los e2e usan fakes de Supabase/GitHub/OpenAI/Sandbox) |
| Higiene | `git status` limpio, 9 ramas (sin nuevas), un solo worktree tras limpiar; PostgreSQL y worktrees bajados y borrados; sin commit, push ni PR |

## (a) Exposición — conforme

Ejecutado con datos hostiles propios (spec temporal en worktree, ya borrado) sobre los tres ensambladores: filas con `excerpt`, `content`, `snippet`, `knowledgeId`, `knowledgeIds`, `omittedRules`, conteos, `groundTruth`, `testCases` con mensajes, `logs`, `stdout`, `url` firmada, `storageKey`, `apiKey`, `baseUrl`, prompt, `args`/`result`/`reasoning` de pasos del agente, campos extra de la fila del Run y de la propuesta, y `failureMessage` antiguo sin sanear (`Cookie: sid=…; password hunter2`).
- Ningún marcador aparece en el JSON del bundle; el conjunto de claves recorrido en profundidad es un subconjunto de las claves de §6.16; `facts` siempre tiene exactamente 14 claves.
- Todo el ensamblado es mapeo explícito campo a campo (`evidence-mapping.ts`, `evidence-bundle.assembler.ts`); `grep` no halla spreads de fila hacia DTO en `src/`. El repositorio de evidencia selecciona columnas explícitas (`evidence.repository.ts:13-72`) y `findContextTracesByRepetitionIds` solo lee `detail` para extraer ids, config, `decision` y la ubicación (`filePath`, `symbolName`, `parentSymbolName`) del excerpt, nunca `snippet`.
- Las claves leídas coinciden con las que escribe de verdad el handler (`makeRagDetail`, `budgetDetail`, `safeAgentStep`, `toFunctionalRuleEvidence`), así que el bundle no queda vacío por desajuste de nombres.
- `failureMessage` se re-sanea al leer (`evidence-mapping.ts:152`) y `failureCode` se revalida (`:151`).
- Nota: `publication.companionPullRequestUrl` es una URL, pero la declara el tipo `TracePublicationResponse` de §6.16 (ya expuesto por `/trace`); no es incumplimiento.

## (b) Contrato — conforme

- `EvidenceBundleResponse` y sus tipos (`dto/evidence-bundle.response.ts`) coinciden campo a campo con el bloque TypeScript de §6.16, incluidos `| null`, `schemaVersion: '1'`, claves de unión `strategy`/`repetition`/`attempt`, `technicallyEvaluable`, `retrieval[].metrics`. Desviaciones de estrechamiento declaradas: `runnerHint` `'JEST'|'VITEST'|null` (contrato `string | null`, deuda `WI-CORE-028`).
- Rutas, Reader, 404 de la ruta de estado homónima, 409 `EVIDENCE_NOT_FINISHED` (`QUEUED`/`PROCESSING`; `PENDING`/`RUNNING`), `FAILED` de experimento y de comparación → 200, comparación `FAILED` → `retrieval: []` (`evidence.service.ts:21-129`). Cubiertas por specs y por la matriz e2e.
- `snapshotRef`: UUIDv5 verificado contra `uuid.uuid5(NAMESPACE_URL, 'urn:tjc:snapshot-ref:v1:{projectVersionId}:{headSha}')` de Python (coincide). `retrievalId = contextId = ContextTrace.id` en EXPERIMENT.
- Sin ceros ni sintéticos: valores de tipo erróneo, negativos, no enteros o cadena vacía salen `null` (`toCount`/`toText`); `artifactHash` de contenido vacío es `null`; la config de retrieval deja `null` lo no persistido; `executionDurationMs` es `null` sin invocación (el handler pasa `null`); `durationMs` negativo del Run se persiste `null` (`clampDuration`, `analysis-trace.repository.ts:45-48`) y el del experimento se emite `null` por `toCount`.
- DEC-EVID-001: `rate()` devuelve `null` sin evaluables (`experiments.service.ts:88-90`), medias con `roundOrNull(mean(no nulos))`, `evaluableRepetitions = vigentes con technicallyEvaluable !== false`, `nonEvaluableRepetitions = vigentes − evaluables`; `findRepetitions` entrega el último intento por slot. Coincide con la definición ratificada de §6.5.1.

## (c) Persistencia — conforme

- Migración `20261009190000`: solo `ADD COLUMN` nullable (11) y 2 CHECK (`durationMs >= 0`; `artifactHash IS NULL OR ~ '^[0-9a-f]{64}$'`); sin backfill ni tablas nuevas (RLS ya vigente); reversible según el encabezado (verificado). `prisma migrate diff` y aplicación en PG: ver tabla.
- Captura best-effort: `writeTerminalRepetition` escribe una sola vez, guardada por `state = RUNNING`; ante excepción reintenta sin las columnas de evidencia y registra solo el nombre del error (`experiment-job.handler.ts:~1360-1388`); en el Run, `recordExecutionBestEffort` y `persistProposal` con reintento `generation: null`. `updateRepetitionById` conserva `where: { id, state: RUNNING }`; `closeInterruptedRepetition` no tiene cambios en el diff y no escribe evidencia.
- Sin hecho inventado: sin invocación, evidencia `null`; error de ejecución aceptada conserva `executionId`/ids/duración; `TIMED_OUT` y `COMPLETED` sin hecho no sintetizan categoría salvo `TEST_ASSERTION` observada (DEC-EVID-006).

## (d) Saneado (corte A) — conforme

Batería propia ejecutada (47 casos + fuzz de 20 000 casos con envoltorios de puntuación, espacios, NBSP, comillas, `\`): Slack `xoxb/xoxp/xoxa`, `sk_live_/sk_test_/rk_live_`, `AIza…`, `npm_…`/`_authToken=`, `Cookie:`/`Set-Cookie:` (también en minúsculas y a mitad de mensaje), `credential=`/`credentials:`/`auth=`/`signature=`, `X-Amz-Signature`, `password hunter2`/`passwd`/`secret`, webhook de Slack, `/token/…`, `/key/…`, `user:p@ss@host`, `user:pa/ss@host`, query y fragmento, JWT, PEM (minúsculas y sin cierre), PGP `PRIVATE KEY BLOCK`, Bearer/Basic, JSON `{"password":…}`, `{"token":[…]}`, `password=[hunter2]`, `password="a\"b c"`, `DATABASE_PASSWORD=`, unicode. Resultado: ninguna fuga, idempotente (`s(s(x)) = s(x)`) y ≤ 500 puntos de código en todos los casos; redactar-antes-de-truncar probado con el secreto en 40 posiciones de corte (480–519). Las fugas que reportó la revisión de 007 (corchetes, `@` en la clave, comilla escapada, PEM en minúsculas, PGP) están corregidas.
- ReDoS: 16 entradas patológicas de 200 000 caracteres (`a-`×100k, `password=`×25k, `https://`×25k, `/token/`×30k, PEM×7k, `cookie:`×28k, `["`×100k, `"a\`×100k, `Bearer a.`×100k, `https://u:@@@…`, `token 1111…`, `passwd \t`×25k, NUL×200k, emoji×200k): 0,6–2,9 ms cada una (< 100 ms).
- `code` fuera de `^[A-Za-z0-9_.:-]{1,64}$` o alterado por el saneado anula el hecho completo (`experiment-failure-fact.ts:62-76`); `category` validada sin `NONE`. Sobre-redacciones declaradas (Cookie hasta el final, `oauth=`, claves que terminan en `key`) confirmadas y aceptadas.

## (e) beginAttempt — conforme

`context-traces.repository.ts:59` usa `tx.$executeRaw`. Barrido de `$queryRaw`/`$executeRaw` en `src/` y `test/`: los `$queryRaw` restantes devuelven columnas (`SELECT "id" … FOR UPDATE`, `jobs`, `SimilarChunk`), no funciones `void`; el otro `pg_advisory_xact_lock` (`project-access.repository.ts:356`) ya usaba `$executeRaw`. `context-traces.repository.pg.spec.ts` llama a `beginAttempt` real (numeración secuencial, concurrencia de 3 intentos → 1,2,3 y una sola traza `current`).

## (f) Calidad de pruebas: mutaciones (worktree desechable, ya eliminado)

Cada mutación sobre el HEAD, ejecutando los directorios `evidence`, `experiments`, `sandbox`, `context-traces`, `analysis-runs`, `validation`, `common` y `prisma` (772 pruebas, 50 files, con los pg specs contra la base desechable) o, para Reader, el e2e `access-matrix`. Todas **detectadas**:

| # | Mutación | Pruebas que fallan |
|---|---|---|
| M1 | Quitar el re-saneado en el export | 5 (assembler, mapping, pg) |
| M2a/b/c/d | Exponer `excerpt`, `testCases`, `groundTruth`, `knowledgeId` | 6 / 7 / 2 / 2 |
| M3 | Spread de la fila del Run en `analysisRun` | 1 |
| M4a/b | `null → 0` en `durationMs` de sandbox (Run / experimento) | 2 / 2 |
| M4c/d | Tasas `0` y media de duración `0` sin evaluables | 2 / 3 |
| M4e/f | Duración negativa → `0` / permitir negativos en `toCount` | 3 / 3 |
| M5 | `beginAttempt` a `$queryRaw` | 6 (pg y unit) |
| M6a | Reader → Writer en `/analysis-runs/:id/evidence` | 2 (e2e) |
| M6b | Quitar `@RequireProjectRole` de la ruta de comparación | suite e2e no arranca (default-deny) |
| M7 | Quitar la guarda `RUNNING` del update terminal | 5 |
| M8 | Añadir una clave al bundle sin subir `schemaVersion` | 3 |
| M9 | Truncar antes de redactar | 6 |
| M10 / M11 | Quitar la guarda de `failure` en escritura / `code` inválido no anula el hecho | 3 / 6 |
| M12 | `artifactHash` del contenido vacío expuesto | 2 |
| M13 | `nonEvaluableRepetitions` fijo en 0 | 2 |
| M14 / M15 | Captura de evidencia sin reintento / sin pasar la evidencia al write | 1 / 9 |
| M16 | `failureMessage` sin sanear en `buildSandboxEvidenceFacts` | 1 |
| M17 | El handler del Run no persiste `generation` | 3 |
| M18 | Categoría de fallo inventada en `COMPLETED` | 7 |
| M19 | `closeInterruptedRepetition` escribe evidencia | 1 |
| M20 | `retrievalId` distinto de `ContextTrace.id` | 2 |

## (g) Higiene — conforme con menores

- Los 25 commits del rango llevan `Refs: HU12, HU15, HU17` (coincide con `storyIds` del WI) y `Co-Authored-By` del modelo que escribió (Haiku 5.5 en A–F/D, Sonnet 5.5 en docs y cambio del leader).
- `29505f2`: 1 archivo, 1 inserción/1 eliminación, solo `evidence.repository.pg.spec.ts` (una expectativa): cumple «cambio mínimo» (≤ 10 líneas, ≤ 2 archivos, solo pruebas).
- Sin ramas ni worktrees sobrantes; `harness/state.json` sin modificar por esta revisión.

## Hallazgos

Sin blockers ni importantes.

### 1. menor — `CS-CORE-20261009-015` apunta a un `sourceRevision` anterior a las correcciones finales de texto de §6.5
- `harness/contract-sync/outbox/CS-CORE-20261009-015.yaml:12` (`sourceRevision: 55e3ec9…`) frente a `3f06f44`, que corrigió en `spec/contracts/interoperability-contract.md` los comentarios de `generationDurationMs`/`totalDurationMs` (media de no nulos, `null` si ninguna la registró), la regla «con repeticiones evaluables, cada media…» y añadió la excepción de `IDEA-017` (`generationDurationMs`/`totalDurationMs` por repetición conservan `0`). El `requiredAction` pide a Console «refrescar el contrato desde sourceRevision»: leería la versión anterior (mismos tipos TypeScript, texto menos preciso). Escenario: Console implementa «null solo si `evaluableRepetitions = 0`» para las medias de generación y total, que es lo que decía `55e3ec9`.
- Mismo patrón, de menor efecto, en `CS-CORE-20261009-014.yaml:12` (`275f687`): en esa revisión §6.16 aún decía «pendiente de verificación final y de la declaración de Implementado».
- Mientras ambos eventos sigan `C-PENDING`, basta con apuntar `sourceRevision` a la revisión final de documentos (o dejarlo declarado en el `changed`). El contenido de ambos eventos es fiel al código (verificado: tipos, contadores, `null` en medias, `retrieval: []` en comparación `FAILED`, sin `excerpt`/`testCases`/`groundTruth`/`knowledgeId`/URLs).

### 2. menor — El commit `275f687` deja roja la expectativa del spec pg que lo cubre hasta `29505f2`
- `app/src/evidence/persistence/evidence.repository.pg.spec.ts:207` esperaba `durationMs: null` y tras el corte F la evidencia emite `200`. Ejecutado: en `275f687`, `evidence.repository.pg.spec.ts` falla (`Expected null, Received 200`); el cambio mínimo `29505f2` lo corrige. Los gates por defecto no lo ven porque ese spec se omite sin `EVIDENCE_TEST_DATABASE_URL`. No afecta al HEAD (104/104 verdes); es higiene de «cada commit verde» para los specs pg.

### 3. menor — Comentario obsoleto en el spec pg de evidencia
- `app/src/evidence/persistence/evidence.repository.pg.spec.ts:130-131` sigue afirmando que `beginAttempt` no se llama porque `pg_advisory_xact_lock` «no se deserializa con $queryRaw», lo que el corte E ya corrigió. Solo comentario.

### 4. menor — `artifactHash` se calcula antes de saber si el contenido llegó al Sandbox
- `app/src/experiments/experiment-job.handler.ts:780-783` asigna el hash antes de `execute`; si `execute` falla antes de aceptar (p. ej. `SandboxUnavailableError` sin `executionId`), `generation[].artifactHash` se emite con un hash de contenido que nunca se envió, mientras `sandbox[]` no existe para esa repetición. §6.16 define `artifactHash` como el SHA-256 del contenido «enviado al Sandbox». Inofensivo (es el hash del contenido generado), pero no es estrictamente «enviado».

## Deuda ya registrada (no bloquea, verificada coherente)
- `IDEA-015` resuelta (`errorSummary`/`failureSummary` saneados y `category` validada); `IDEA-016` residuos (familias sin patrón como `%3D` codificado, log de `category`/`code`, Cookie hasta el final).
- `IDEA-017`: `experiments.service.ts:300,302` emite `?? 0` por repetición en `generationDurationMs`/`totalDurationMs` (documentado en §6.5.1).
- `modelVersion` siempre `null`; `runnerHint` estrechado a `JEST|VITEST` (PHPUNIT descartado hasta `WI-CORE-028`); `executionDurationMs` negativo del experimento se guarda tal cual y se emite `null`; `$queryRaw` con funciones `void` sin lint; migraciones `…130000`–`…190000` sin aplicar a una base real (aquí aplicadas solo a PostgreSQL 14 desechable con shim de pgvector).

## Lo no ejecutado (razonado)
- No se corrió contra PostgreSQL 17 ni con pgvector real (solo PG 14 con shim); el `void` ya lo confirmó el implementer en 17.6 y el barrido estático no halla otro caso.
- No se probó el flujo HTTP completo de `/evidence` con repositorios reales de Run (`AnalysisRunsService` + `loadTargets`); lo cubren specs de servicio/controlador con mocks, el pg spec de ensamblado con repositorios reales y la matriz e2e con servicio fake.

## Handoff
- `status`: APPROVED
- `blockers`: ninguno
- `filesAffected`: `harness/reports/wi-core-027-independent-review.md` (creado, sin commitear)
- `recommendedNextStep`: el leader puede cerrar el WI (PULL `before-done`, `W-DONE`) con los 4 menores registrados; recomendable alinear `sourceRevision` de CS-014/CS-015 antes de que Console los acuse y corregir el comentario obsoleto en una pasada de docs. Push/PR solo a pedido explícito del usuario, con la revisión acumulada del rango.
