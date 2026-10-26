# WI-CORE-105 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

## Veredicto: CHANGES_REQUESTED (cambios pequeños; ningún hallazgo de severidad alta)

El código cumple lo aprobado y las garantías previas del extractor siguen intactas. Pido corregir dos hallazgos medios (H1, H2) porque hacen que una herramienta diga ✅ cuando la evidencia es parcial, que es justo lo que C3 y la puerta de qualification quieren evitar. El resto son observaciones bajas.

## Hallazgos

### H1 (media) — `baseline-workspace` y `preflight after (e)` dan ✅ con un manifiesto parcial
- `snapshot-manifest.mjs` declara en `skipped` lo que NO lista en `entries`: `total_too_large` (el recorrido se detiene y las entradas restantes no aparecen en `entries`), `unsafe_path` y `duplicate_path`. Además lista con `sha256: null` las `too_large`/`unreadable`.
- `baseline-workspace.mjs` solo lee `manifest.entries` (nunca `manifest.skipped`) y devuelve exit 0 con «Resultado: ✅ todo lo comparable coincide» si lo listado coincide. Con `total_too_large` la baseline queda sin archivos que el Sandbox sí recibió y el resultado es ✅. Las entradas con `sha256: null` cuentan como «omitidas» y tampoco bajan el exit code. Línea: `baseline-workspace.mjs` `exitCode = counts.missing > 0 || counts.different > 0 || counts.rejected > 0`.
- `preflight.mjs:485-499` (`checkSnapshot`) devuelve ✅ para cualquier manifiesto con esquema válido: con `entries: []`, o con `skipped` no vacío, solo lo muestra en el detalle («N omitidas»). Un manifiesto con 0 entradas es ✅.
- Corregir: (i) baseline: si `manifest.skipped` tiene algo (o hay entradas con `sha256 null`), no imprimir «✅ todo lo comparable coincide» sino ⚠️ «el manifiesto declara omisiones; la baseline no es el mismo conjunto» y salir con un código distinto de 0 (o 1) — decisión del leader, pero debe ser visible; (ii) preflight (e): ⚠️ si `skipped` no está vacío o hay `sha256 null`, y ⛔ si `entries` está vacío; (iii) una prueba por cada caso.

### H2 (media) — la comprobación (f) «9 enlaces» solo verifica que el archivo exista
- `preflight.mjs:501-506` `checkTrace9`: cualquier JSON válido → ✅ «presente». El archivo trae `directLinks[].verdict` y `inverseChecks[].verdict` (`PRESENT` / `NOT_APPLICABLE` / `INCONSISTENT`, `trace.mjs:125-151`). Un Run con enlaces `INCONSISTENT` pasa ✅.
- La documentación sobre-afirma: `oe5-v2-qualification-criterios.md` Q-h («los 9 enlaces … comprobaciones a, b, f, g»), README («(f) trace-9-links.json»), CHANGELOG y el alcance («9 enlaces»). CT-08 depende de la auditoría de los nueve enlaces.
- Corregir (cualquiera de las dos): hacer que (f) devuelva ⛔ si algún `verdict` es `INCONSISTENT` y ⚠️ si hay enlaces `NOT_APPLICABLE` (con su número en el detalle), con prueba; o reescribir README, CHANGELOG y Q-h para decir que solo comprueba presencia del archivo y que los veredictos se leen a mano.

### H3 (baja) — `baseline-workspace` falla con excepción ante rutas equivalentes del manifiesto
`isSafeArchivePath` deja pasar segmentos `.` (`./x.php`, `a/./b.php`). El manifiesto puede traer `x.php` y `./x.php` como dos entradas distintas (el chequeo de duplicados es textual); ambas resuelven al mismo archivo y la segunda hace `writeFile` con `wx`: `EEXIST`, exit 1 genérico y `--out` a medias. Reproducido: `Error: EEXIST: file already exists, open '…/out1/src/a.php'`. Igual con sistemas de archivos insensibles a mayúsculas. Sugerencia: rechazar segmentos `.` en `isSafeArchivePath` (el Sandbox tampoco los espera) o normalizar antes de comparar duplicados, y capturar `EEXIST` como «conflicto de rutas».

### H4 (baja) — falsos positivos de `envSuspect`
Probado con `detectEnvSuspect`: `ENV-03` y `ENV-04` se evalúan con cualquier `failureType`, así que `TEST_ASSERTION` con «Allowed memory size … in /app/src/X.php» (bucle de la estrategia) marca `ENV-03`, y un test generado que abre un socket («Connection refused to localhost:5432») marca `ENV-04`; `ENV-01` marca un fixture inventado por la estrategia bajo `/app/`. Los tres fallos de estrategia conocidos NO marcan (verificado: `runner results file is empty … Fatal error` abstractos, `Class "…" not found`, `Call to private …::__construct()` → `[]`). Es informativo, está declarado como heurística en README y módulo; solo dejo constancia. Opcional: restringir ENV-04 a `DEPENDENCY`/`INFRASTRUCTURE`.

### H5 (baja) — huecos de prueba (sobreviven mutaciones)
- `redirect: 'manual'` → `'follow'` en `preflight.mjs`: las 362 pruebas pasan (el `fetch` doble no comprueba las opciones). Es una garantía de seguridad declarada sin prueba.
- Comprobación de tamaño del manifiesto en baseline (`info.size !== entry.bytes`): sobrevive (redundante con el SHA, pero no probada).
- Modo `0644` de la copia y `flag: 'wx'` de baseline y de `--json`: sobreviven (el `--json` ya está protegido por el `stat` previo).

### H6 (baja) — alcance de «lo que recibió el Sandbox»
La clave se compone `project-versions/<id>/snapshot.zip` (coincide con `snapshot-analysis-job.handler.ts:459`) en lugar de leer `project_versions.snapshotKey`, que el experimento sí usa (`experiment-job.handler.ts:257`). El extractor no consulta esa columna (el SQL no cambió, a propósito). Coincide hoy, pero la afirmación «es la verdad de lo que recibió el Sandbox» es una inferencia: el objeto es el actual de Storage, no necesariamente el del momento del experimento. Conviene matizarlo en README/alcance. Además `--storage-max-bytes` vale 5 MiB por defecto: un ZIP mayor queda como ausencia `too_large` (documentado en README y runbook; correcto).

### H7 (baja) — `/health` 200 solo prueba que el proceso despierta
`before` no lee el cuerpo (a propósito), así que un 200 con servicio degradado pasa ✅. Es coherente con lo declarado; solo anoto la limitación en el runbook.

## Verificado sin hallazgo
1. Extractor: SQL registrado sin cambios; transacción READ ONLY y `ROLLBACK` intactos (prueba existente); Storage solo `download`; la clave del snapshot se compone con `^[A-Za-z0-9_-]{1,100}$` (un `projectVersionId` con `../` no se descarga: prueba y mutación que lo detecta); el tope `--storage-max-bytes` se aplica al `download` (5 MiB por defecto, mismo descargador); errores sin texto del proveedor (`SNAPSHOT_ABSENCE_TEXT`); `snapshot-manifest.json` entra en `manifest.json`, `hashes.txt` y README del paquete (prueba).
2. `buildSnapshotManifest`: nunca lanza (`invalid_zip`); con ZIP crudo (Python, sin sanear) las rutas `../evil.php`, `..\w.php`, `/abs.php`, `C:/x`, `a/../../q.php`, `a//b.php`, `a\b.php` y NUL se rechazan y los duplicados van a `skipped`; `dir/` se ignora; orden determinista. Bomba ZIP: con adm-zip 0.6.0, un ZIP de 300 MiB con tamaño declarado falso (100) da `unreadable` en 7 ms y 48 MB de RSS; los topes 16 MiB por entrada y 256 MiB totales actúan con el tamaño declarado y tras descomprimir (mutaciones detectadas). No rechaza nada legítimo que haya encontrado (acepta nombres con espacios, Unicode y `.hidden/`); solo deja pasar `.` (H3).
3. `baseline-workspace`: con un checkout con enlaces simbólicos hacia fuera (`link/s.txt`, `src/sym.php`) ambos salen `rejected` y no se copian; `--out` dentro del checkout y `--out` que contiene el checkout salen con 2; no copia archivos con SHA distinto (mutación detectada); no imprime contenido; salida 1 con faltantes/distintos/rechazados.
4. `oe5-preflight before`: URL `https` o `http` solo en loopback, sin credenciales, ruta, consulta ni fragmento; el error no repite la URL; `redirect: 'manual'`; no lee cuerpos ni cabeceras; el tiempo de espera es acotado; códigos 0/1/2 (prueba de CLI como proceso). `after`: `--json` dentro del paquete se rechaza (mutación detectada), `wx` y modo 0600; un paquete anterior a WI-105 da ⚠️ en (g) por falta de la columna; faltantes dan ⛔.
5. Umbrales contra el código: `gpt-6-luna`/`medium` (AGENTS.md de cross); presupuesto 20/8000/120000 = `generation-budget.defaults.ts`; `LAYERED` 0.6/4000/2000 = `context-builder.service.ts:56-58`; la traza persistida lleva `configuration` con `strategy`, `relevanceThreshold`, `declaringClassMaxTokens` y `targetEvidenceMaxTokens` (`experiment-attempt-presenters.ts:155`, contrato INTEROP-2.22 §6.7); `modelConfig` puede traer `temperature` (`EXPERIMENT_LLM_TEMPERATURE` existe), por eso ⚠️ es correcto; claves de `hash-verification.json` (`summary['coincide' | 'no coincide' | 'no verificable']`) coinciden con `countVerdicts`.
6. `envSuspect`: columna al final de `repetitions.csv`; no está en `experiment.json` (prueba); la prueba de paridad y la CLI siguen en verde; solo informativa (nada la consume para puntuar).
7. Registros: `work-items.json`/`state.json` dejan `independentReviewPassed: G-NOT_RUN` y `reviewCycles: 0`; `tasks.md` con ST-CORE-127 abierto; sin cambios en `app/src`, contrato, esquema ni migración; CHANGELOG y reporte técnico exactos respecto del código salvo H2. La nota de `pnpm` del README es correcta: `pnpm run evidence:preflight -- --help` ejecuta `node scripts/oe5-preflight.mjs -- --help` y falla con «subcomando desconocido» (exit 2), mientras que `npm run … --` funciona.

## Comandos y resultados (desde `app/`, PATH con node22)
- `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run`: 197 archivos pasan, 10 omitidos; 3526 pruebas pasan, 121 omitidas (coincide con lo esperado).
- `corepack pnpm@12.14.0 lint`: exit 0 (no cubre `scripts/`). `./node_modules/.bin/oxlint scripts/`: 2 advertencias, ambas preexistentes (`trace.mjs:118`, import `UsageError` sin usar en `extraction.spec.ts`, ya existía en HEAD); ninguna en archivos nuevos.
- `corepack pnpm@12.14.0 build`: exit 0.
- `node harness/validate-harness.mjs`: passed; `node harness/validate-work-items.mjs`: passed (CORE, 104 WI); `node scripts/sdd-check.mjs`: OK.
- Escenarios ad hoc en el directorio de trabajo temporal (sin red, sin base de datos): ZIP crudo con rutas hostiles, ZIP con tamaño declarado falso, checkout con enlaces simbólicos, `detectEnvSuspect` con 16 textos.

## Mutaciones ejecutadas (restauradas; `cmp` idéntico a la copia previa y `git status`/`git diff --stat` sin cambios: 24 rutas, 9 archivos, +470/-20)
Detectadas: sin `..` (3 fallos), sin `\` (3), baseline sin SHA (2), baseline sin comprobación de enlace simbólico (1), ENV-01 sin `/app/` (1), `http` no loopback (2), `--json` dentro del paquete (2), hashes con discrepancia ignorados (1), `promptSha256` estructural (3), patrón de id laxo (1), `reasoningEffort` no verificado (1), `budget` no verificado (1), mínimo de fixtures (1), `temperature` (1), repetición efectiva por intento (2), clasificación VT (1), duplicados del manifiesto (1), sin tope por entrada (1), sin tope total (1), `envSuspect` vacío en el CSV (1).
Supervivientes: tamaño del manifiesto en baseline, `redirect: 'manual'`, `--json` con `wx`, baseline con `wx`, modo `0644` (H5).

## Qué debe corregirse para aprobar
1. H1: baseline y preflight (e) no pueden dar ✅ con `skipped` no vacío, entradas con `sha256 null` o `entries` vacío; con pruebas.
2. H2: (f) debe leer los veredictos de `trace-9-links.json` (⛔ ante `INCONSISTENT`, ⚠️ ante `NOT_APPLICABLE`) con pruebas, o la documentación (README, CHANGELOG, Q-h, alcance) debe decir que solo comprueba presencia.
H3 a H7 son opcionales (recomendados H3 y la prueba de `redirect: 'manual'`). Tras corregir, basta una segunda revisión acotada a esos cambios (ciclo 2 de 2).

## Re-revisión del ciclo 2
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo low

### Veredicto: APPROVED (sin hallazgos medios ni altos; dos observaciones bajas)

### Estado de los hallazgos del ciclo 1
- **H1 resuelto.** `baseline-workspace.mjs` sale con 1 y escribe «⛔ manifiesto parcial o vacío» si `entries` está vacío, `skipped` no está vacío o hay entradas con `sha256: null`; los motivos de `skipped` se muestran como recuento (sin rutas). Verificado con la CLI real: un manifiesto con `skipped: [total_too_large]` da ⛔ y copia lo que coincide; uno completo da ✅. `preflight (e)`: ⛔ con 0 entradas, ⛔ si falta el mínimo de fixtures, ⚠️ con `skipped` o `sha256 null`, ✅ solo completo. Mutaciones detectadas: exit sin `isPartial` (3 fallos), `isPartial` apagado (5), vacío no parcial (1), (e) sin chequeo de vacío (1) y (e) sin chequeo de parcial (3).
- **H2 resuelto y la forma es correcta.** `checkTrace9` exige `directLinks` de exactamente 9 elementos y `inverseChecks` con `verdict` en {PRESENT, NOT_APPLICABLE, INCONSISTENT}: ⛔ INCONSISTENT, ⚠️ NOT_APPLICABLE, ✅ todo PRESENT, ⛔ forma inválida, ⚠️ si falta el archivo. Contrastado con `trace.mjs`: `buildDirectLinks` genera siempre los números 1 a 9 y los veredictos de enlaces directos e inversos solo toman esos tres valores (`linkVerdict`, `inverseVerdict`). Los textos de enlace mostrados pasan por una lista de caracteres permitidos. Mutaciones detectadas: sin INCONSISTENT (1), sin NOT_APPLICABLE (1), sin el 9 (1), sin validar inversos (1).
- **H3 resuelto.** `isSafeArchivePath` rechaza el segmento `.`; con el manifiesto que antes producía `EEXIST` la CLI ahora sale con error de uso («ruta no segura») antes de crear `--out` (no existe el directorio). La colisión de escritura (`EEXIST`/`ENOTDIR`/`EISDIR`) se registra como `rejected` y no lanza (mutación «colisión lanza»: 1 fallo). Mutación sin segmento `.`: 6 fallos.
- **H5 resuelto en lo esencial.** Mutaciones ahora detectadas: tamaño del baseline (1), modo 0644 (1) y `redirect: 'follow'` en la llamada real (2 fallos; mi primera mutación apuntó por error a un comentario y no cuenta). Sobreviven `flag: 'wx'` y modo 0600 del `--json` (ver O1).
- **H4, H6, H7 (documentados).** Aparecen en la sección «Limitaciones» del README con lo que el código hace: reglas ENV-03/ENV-04 con cualquier tipo de fallo, manifiesto = objeto actual de Storage con clave compuesta, `/health` 200 solo prueba que el proceso despertó. Exactos respecto del código.

### Verificación (desde `app/`)
- vitest completo: 197 archivos pasan, 10 omitidos; 3556 pruebas pasan, 121 omitidas (coincide con lo esperado).
- `pnpm lint` exit 0; `oxlint scripts/`: las mismas 2 advertencias preexistentes; `build` exit 0; `validate-harness`, `validate-work-items` (CORE, 104 WI) y `sdd-check`: OK.
- Pruebas no debilitadas: sube el total de 3526 a 3556 y ninguna de las mutaciones del ciclo 1 que se detectaban deja de detectarse (repetí las relevantes: mismos o más fallos); no encontré aserciones relajadas en las comprobaciones de H1 a H3.
- Documentos: README (secciones baseline, preflight y Limitaciones), Q-h de `oe5-v2-qualification-criterios.md` («veredictos PRESENT; NOT_APPLICABLE justificado; ningún INCONSISTENT» y checklist manual de CT-08 de cross) y la sección «Ciclo 1» de `wi-core-105-technical-checks.md` describen lo que hace el código. Observación menor en O2.
- Restauración: `cmp` idéntico contra la copia previa de todos los `.mjs` tras cada mutación; `git diff HEAD --stat` = 9 archivos, +473/-20 (igual que antes de mutar); sin `stash/checkout/reset/clean`.

### Observaciones bajas (no bloquean)
- **O1:** siguen sin detectarse `flag: 'wx'` y el modo `0o600` del `--json` en `preflight.mjs` (el `stat` previo ya impide sobrescribir; el modo no tiene prueba). Opcional.
- **O2:** la sección «Pruebas y sanidad de mutaciones» del reporte técnico conserva el texto original del ciclo 0 (163 pruebas, 7 mutaciones) y la sección «Cambio» sigue diciendo que el baseline sale con 1 «con faltantes, distintos o rechazados» sin mencionar el parcial; la sección del ciclo 1 al final lo corrige, así que no es incorrecto, solo disperso.
