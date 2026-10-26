# Scripts de `app/scripts`

Herramientas del repositorio que no forman parte del producto (no entran en `dist`, ni en `oxlint`, ni en el build).

| Script | Qué hace |
|---|---|
| `generate-contract-types.mjs` | Genera o verifica los tipos de contratos (`pnpm contracts:generate` / `pnpm contracts:check`). |
| `local-php-env.mjs` | Genera los `.env` locales para probar PHP en local. |
| `extract-evidence.mjs` | Extractor de evidencia de solo lectura (WI-CORE-094). Ver abajo. |
| `oe2.mjs` | Herramientas de evaluación OE2 de retrieval (WI-CORE-107; guía, roles y verdad de terreno en WI-CORE-108): volcados, muestra, hojas ciegas, verdad de terreno y puntuación. Ver al final. |

## Extractor de evidencia (`extract-evidence.mjs`)

Lee, de la base de desarrollo y de Storage, lo que el producto **ya persistió** de un AnalysisRun y/o un ExperimentRun, y lo escribe en una carpeta con JSON y CSV. No modifica nada: no escribe en la base, no crea roles, no aplica migraciones y no escribe en Storage.

### Uso

Desde `tjc-be-rag-core-api/app`:

```bash
npm run evidence:extract -- --out <carpeta> [--analysis-run <id>] [--experiment <id>] [--include-pii] [--allow-out-in-repo]
# o directamente (con pnpm 12 usa SIEMPRE esta forma: reenvía el `--` al script y falla con «argumento desconocido»):
node scripts/extract-evidence.mjs --out <carpeta> --experiment <id>
```

- `--out <carpeta>` (obligatoria): debe estar vacía o no existir, y por defecto no puede estar dentro del repositorio.
- `--analysis-run <id>` y/o `--experiment <id>`: al menos uno. Si solo das el experimento y tiene `analysisRunId`, se extrae también ese AnalysisRun.
- `--include-pii`: incluye `actorLogin`, `prTitle`, refs/`branchName` y la URL del companion PR. Por defecto se anonimizan (seudónimo estable) u omiten.
- `--allow-out-in-repo`: permite una `--out` dentro del repositorio (intencional, no recomendado).
- `--storage-max-bytes <n>`: tope de tamaño por objeto de Storage (por defecto 5242880 = 5 MiB; máximo 67108864). Un objeto mayor se declara ausente en el manifiesto.

Códigos de salida: `0` correcto, `1` error de ejecución, `2` uso incorrecto.

### Variables de entorno (las exportas tú en TU shell)

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a la base de **desarrollo** con el rol propietario (el de Core). Todo corre dentro de una transacción `SET TRANSACTION READ ONLY` con solo `SELECT`. |
| `SUPABASE_URL` | No | Con `SUPABASE_SECRET_KEY` y `SUPABASE_STORAGE_BUCKET` descarga los test generados de las propuestas. |
| `SUPABASE_SECRET_KEY` | No | Solo se usa para `download`. No se usa para crear ni borrar nada. |
| `SUPABASE_STORAGE_BUCKET` | No | Bucket de Storage del producto. |

El script **no carga `.env`** ni `dotenv`. Si falta una variable de Storage, esa parte se declara como ausente en el manifiesto y el resto se extrae igual. Nunca imprime ni escribe el valor de estas variables; los mensajes de error se sanean antes de mostrarse.

> Advertencias: la base de desarrollo es la **misma** que usa Core en Render; son datos vivos aunque la lectura sea de solo lectura. Los tests generados y los fragmentos de contexto pueden contener **código de terceros** (repositorios públicos de pilotos) y datos personales. Trata el paquete como datos sensibles y no lo subas a ningún sitio compartido.

### Qué escribe (paquete)

| Archivo | Contenido |
|---|---|
| `manifest.json` | Versión del esquema, `generatedAt`, herramienta, identificadores, `includePii`, decisiones de PII y PII residual, migraciones, estado de Storage (tope y omisiones), **ausencias** y **truncados**, lista de archivos con tamaño y SHA-256. |
| `manifest.sha256` | Sello `sha256sum` de `manifest.json`. Excepción declarada: ni el manifiesto ni su sello pueden listarse a sí mismos; si necesitas probar la integridad del manifiesto, séllalo externamente (p. ej. en el handoff). |
| `README.txt` | Explicación breve del paquete. |
| `hashes.txt` | Formato `sha256sum` de todos los archivos (salvo `manifest.json`, `manifest.sha256` y sí mismo). |
| `hash-verification.json` | Hash persistido frente al recalculado sobre los bytes de la base o de Storage: `coincide`, `no coincide` o `no verificable` (con motivo). |
| `trace-9-links.json` | Los 9 enlaces del AnalysisRun en sentido directo y el **chequeo inverso** (cada consulta, filas que rompen el enlace y veredicto `PRESENT` / `NOT_APPLICABLE` / `INCONSISTENT`). |
| `analysis-run.json`, `generated-tests.csv` | AnalysisRun, símbolos, retrievals, contextos, propuestas, ejecuciones del Sandbox y publicaciones (con la política de PII aplicada). |
| `generated-tests/NN-<símbolo>.<ext>` | Test generado de cada propuesta, descargado de Storage. |
| `experiment.json`, `repetitions.csv` | Experimento (`modelConfig` sin `endpoint`, `budget`, semilla, pares), repeticiones, intentos, tokens, tiempos y verificaciones. `repetitions.csv` termina con la columna informativa `envSuspect` (ver más abajo). |
| `tests/<estrategia>/<repetición>-<intento>.<ext>` y `.meta.json` | Bytes **exactos** de `testContent` tal como están en la base, sin redactar, con su verificación. |
| `sandbox-evidence.json` | **Copia redactada** de la evidencia del Sandbox y del reporte del runner. Los hashes persistidos se verifican sobre la base; los de la copia son independientes. |
| `context-traces.json` | Trazas de contexto tal como se persistieron (fragmentos de hasta 2000 caracteres). |
| `snapshot-manifest.json` | **Solo con `--experiment` y Storage configurado** (WI-CORE-105): clave, bytes y SHA-256 del `snapshot.zip` que recibió el Sandbox (`project-versions/<projectVersionId>/snapshot.zip`) y, por entrada, ruta, bytes y SHA-256; conteos por extensión y `skipped` (rutas inseguras, duplicadas o entradas enormes, sin descomprimir). Si falta, `manifest.json` declara la ausencia (`snapshot.zip (Storage)`) y `storage.snapshot` dice por qué (`not_found`, `too_large` con `--storage-max-bytes`, `error`…). |
| `tabla70-autofill.json` | Solo las columnas automáticas de la Tabla 70 (Fecha, Proyecto/snapshot/Run y Tipo parcial); el resto queda manual. |

### `envSuspect` (informativo; WI-CORE-105)

Columna al final de `repetitions.csv` con los identificadores de las reglas que coinciden con el texto del error de la repetición (unidos por `;`; vacío si ninguna). **No es un veredicto, no puntúa y no excluye repeticiones de VT**: es una ayuda para separar a mano fallos de entorno de fallos de estrategia. Reglas declaradas ex ante en `evidence-extractor/env-suspect.mjs`: `ENV-01` archivo o recurso bajo `/app/` no encontrado (`Failed to open stream` / `No such file or directory`, solo `TEST_RUNTIME` o `COMPILATION`), `ENV-03` límite de memoria de PHP, `ENV-04` fallo de red o de resolución al instalar dependencias. No se marcan `runner results file is empty` (también lo produce un `Fatal error` de la estrategia, p. ej. métodos abstractos sin implementar) ni `Class "…" not found` (puede ser la estrategia). Son heurísticas de texto: falsos positivos y negativos posibles.

### Baseline sobre el mismo conjunto de archivos (`baseline-workspace.mjs`; WI-CORE-105)

```bash
node scripts/baseline-workspace.mjs --checkout <dir> --manifest <snapshot-manifest.json> --out <dir>
```

Copia desde un checkout local **exactamente** los archivos del `snapshot-manifest.json` (lo que recibió el Sandbox: pool PHP más fixtures de texto, WI-CORE-102), verificando el SHA-256 de cada uno; los faltantes, los distintos y los que apuntan fuera del checkout no se copian y el código de salida es `1`; también sale con `1` si el manifiesto es parcial o vacío (`skipped`, entradas sin SHA-256 o sin entradas): la baseline no cubriría todo lo que recibió el Sandbox. Rutas del manifiesto con segmentos `..` o `.` se rechazan (código `2`) antes de crear `--out`. No usa red ni git: el checkout debe estar en el **HEAD del PR** y con `core.autocrlf=false`, o los hashes diferirán. Úsalo para que la baseline externa corra sobre lo mismo que ve el producto (en el v1 corrió sobre el repositorio completo y no era comparable).

### Preflight por caso (`oe5-preflight.mjs`; WI-CORE-105)

```bash
node scripts/oe5-preflight.mjs before --core-url https://<core> --integration-url https://<integration> --wait-ms 90000
node scripts/oe5-preflight.mjs after  --package <carpeta del extractor> [--expect-fixtures-min <n>] [--json <archivo fuera del paquete>]
```

- `before`: `GET <url>/health` de Core e Integration y espera HTTP 200 (con `--wait-ms` reintenta cada 5 s por el arranque en frío de Render). No imprime cabeceras ni cuerpos. No comprueba el SHA desplegado (el `/health` no lo expone; se mira con la CLI de Render), ni el digest de la imagen del Sandbox, ni `modelConfig` (solo existe tras crear el experimento): ver `harness/reports/oe5-v2-qualification-criterios.md`.
- `after`: lista de comprobación **offline** sobre un paquete ya extraído: (a) 6 repeticiones efectivas (3 `RAG` + 3 `GENERALIST_AGENT`), (b) hashes sin discrepancias (`promptSha256` es siempre «no verificable» y se cuenta aparte), (c) `modelConfig` (`gpt-6-luna`/`medium`, `temperature` null) y `budget` (20/8000/120000) esperados, (d) `configuration.strategy` y parámetros de contexto esperados en las trazas RAG, (e) `snapshot-manifest.json` (⛔ si no tiene entradas, ⚠️ si es parcial —`skipped` o entradas sin SHA-256—, ✅ solo si es completo; con `--expect-fixtures-min`, un mínimo de fixtures), (f) `trace-9-links.json` (lee los veredictos de los 9 enlaces y del chequeo inverso: ⛔ ante `INCONSISTENT`, ⚠️ ante `NOT_APPLICABLE` —debe estar justificado—, ✅ si todos son `PRESENT`; ⚠️ si falta el archivo), (g) VT de las repeticiones no válidas etiquetado «estrategia» o «entorno sospechoso (revisar)» según `envSuspect`. Salida con ✅/⚠️/⛔; código de salida `1` si hay algún ⛔. Con `--json` escribe el informe estructurado fuera de la carpeta del paquete (no altera su sellado).

### Qué NO contiene (y el manifiesto lo declara)

Prompt completo (solo `promptSha256`), respuesta cruda del LLM, contexto RAG completo, trazas completas del agente, oráculo, log completo de `composer install`, códigos de salida, stdout/stderr de AnalysisRun, versiones previas de una propuesta, tarifa de costo aplicada ni `composer.lock`. Tampoco contiene credenciales: ni `DATABASE_URL`, ni `SUPABASE_URL`, ni `SUPABASE_SECRET_KEY`.

Las migraciones de evidencia (`20261013100000_experiment_repetition_artifacts` y `20261013110000_experiment_trial_reconstruction`) se comprueban en la base. Si falta una, la parte que depende de ella se declara como ausente en vez de fallar a medias.

### Verificar el paquete

Dentro de la carpeta del paquete:

```bash
shasum -a 256 -c hashes.txt      # datos
shasum -a 256 -c manifest.sha256  # manifiesto (sellar externamente para probar su integridad)
```

Permisos: archivos `0600` y carpetas `0700` (si la carpeta `--out` ya existe vacía, se conserva su modo: créala tú con `0700` o ejecuta `chmod 700 <carpeta>` antes). Si copias el paquete, hazlo con las mismas precauciones: contiene datos internos.

Y revisa `manifest.json` (ausencias y truncados) y `hash-verification.json` (los `no verificable` tienen motivo; un `no coincide` requiere revisión).

### Garantías del script

- **La barrera real es la transacción READ ONLY.** Se envía `SET TRANSACTION READ ONLY` como primera sentencia tras el `BEGIN` del adaptador.
- **Consultas registradas.** Solo se envían consultas constantes de `queries.mjs` (lista blanca exacta, `approvedSqlTexts()`). Usan identificadores camelCase entre comillas dobles y parámetros posicionales; ninguna interpola valores.
- **La guardia léxica (`sql-guard.mjs`) es una segunda barrera**, no la garantía de solo lectura: exige una única sentencia `SELECT`/`WITH`, sin escrituras, sin `FOR UPDATE`, `INTO`, `$`, barras invertidas (ni `E'...'` ni `U&'...'`) y solo llamadas a `count`, `left`, `length`, `CAST`, `ARRAY` y `to_regclass`. Rechaza las demás funciones (p. ej. `query_to_xml`, `pg_*`, `lo_*`, `set_config`, `nextval`, `dblink`) en los casos probados, pero es léxica y no es infalible (p. ej. un identificador entre comillas seguido de un comentario antes del paréntesis podría pasarla): la barrera efectiva es `SET TRANSACTION READ ONLY` más la lista cerrada de consultas aprobadas de `queries.mjs`, que `session.mjs` exige antes de enviar nada.
- **Transacción cerrada explícitamente.** Siempre se envía `ROLLBACK` (también tras un error) y después se libera la conexión y se cierra el pool. No se envía `COMMIT`. El adaptador solo libera la conexión en `rollback()`; el SQL lo emite el script.
- **Storage** solo usa `download`, con un cliente propio (no el adaptador del producto, que crea buckets). Una clave que no empieza por `analysis-runs/<runId>/proposals/` no se descarga (`outside_prefix`). Un objeto mayor que el tope se declara como `too_large`. El tope se aplica al Blob antes de bufferizarlo; la transferencia ya ocurrió (el SDK no permite conocer el tamaño sin `list`/HEAD).
- La carpeta de salida se valida antes de leer la base y el paquete se escribe solo al final, con `wx` (no sobrescribe) y permisos restrictivos. La escritura no es atómica: si falla a mitad, la carpeta queda parcial y la siguiente ejecución la rechaza por no estar vacía; bórrala antes de reintentar.
- La redacción de secretos solo se aplica a la copia de `sandbox-evidence.json`; el contenido de las pruebas nunca se redacta.
- Los mensajes de error sustituyen `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY` completos y, por separado, el usuario, la contraseña y el host de ambas URL.

### Pruebas

```bash
npx vitest run scripts/evidence-extractor
```

Las pruebas usan dobles de la base y de Storage; no se conectan a nada. Corren con `pnpm test` y en CI.

### Limitaciones

- `pnpm lint` (`oxlint src/ test/`) y `pnpm lint:types` no cubren `app/scripts/`.
- Las pruebas incluyen una prueba de la CLI como proceso (`spawnSync`) con un puerto cerrado y marcadores en el entorno.
- El script no verifica PR ni HEAD contra GitHub; no es posible con lecturas de base.
- Pseudonimizar no es anonimizar: la sal es pública y un valor corto puede reconstruirse por fuerza bruta. No compartas el paquete como si estuviera anonimizado.
- **PII residual (sin cambio de comportamiento por defecto).** Estos campos de texto libre NO pasan por la política y se copian tal cual: `test_publications.failureMessage`, `analysis_runs.resultSummary`, `generated_test_proposals.failureSummary` y `generation`, `experiment_runs.failureMessage`, `analysis_contexts.omittedFunctionalRules`, `analysis_run_executions.failure`, los fragmentos de `context-traces.json` y `errorSummary`/`failure` de repeticiones (en copia redactada). Además, `repositoryName` + `prNumber` identifican el PR en un repositorio público: con ellos el login seudonimizado puede recuperarse en GitHub. Está listado en `manifest.json` → `piiPolicy.piiResidual`.
- El tope de Storage se aplica después de la transferencia (ver garantías).
- **`snapshot-manifest.json` es el objeto actual de Storage para esa ProjectVersion** (WI-CORE-105): la clave `project-versions/<projectVersionId>/snapshot.zip` se compone, no se lee de `project_versions.snapshotKey` (hoy coinciden, `snapshot-analysis-job.handler.ts`), y es lo que hay ahora en Storage, no necesariamente lo que existía en el instante del experimento si el análisis se reintentó. Un manifiesto con `skipped` o con entradas `sha256: null` es parcial: el baseline y el preflight lo marcan.
- **`envSuspect` es heurístico:** `ENV-03` y `ENV-04` se evalúan con cualquier tipo de fallo, así que un bucle de memoria o un socket abierto por la estrategia pueden marcarse como entorno; solo informan, nunca puntúan ni excluyen.
- **`oe5-preflight before`:** un `/health` en 200 solo prueba que el proceso despertó; no prueba que Core ya verifique el acceso a GitHub ni que Integration reciba webhooks (ver el runbook).
- El manifiesto no puede probar su propia integridad (ver `manifest.sha256`).

## Evaluación OE2 de retrieval (`oe2.mjs`; WI-CORE-107, ampliado en WI-CORE-108)

CLI de solo lectura sobre la base (solo `dump-chunks` y `dump-results`) y sobre archivos locales (el resto). Uso desde `app/`:

```bash
node scripts/oe2.mjs <subcomando> [opciones]     # sin subcomando: ayuda (exit 0)
```

Códigos de salida: **0** correcto; **1** error de ejecución, diferencias (`compare-dumps`) o incongruencias de re-ranking (`score`); **2** uso incorrecto. `DATABASE_URL` se exporta en tu shell; el script no carga `.env` y no imprime valores de configuración. `--out` debe estar vacía o no existir y, salvo `--allow-out-in-repo`, fuera del repositorio. Toda salida escrita lleva `manifest.json` (tamaño y SHA-256 por archivo), `hashes.txt` y `manifest.sha256`; `compare-dumps` sin `--out` solo imprime el resumen y no escribe nada.

| Subcomando | Entrada | Salida (en `--out`) |
|---|---|---|
| `dump-chunks --project-version <id>` | base (solo lectura) | `chunks.jsonl` (una línea por chunk: `filePath, symbolKind, symbolName, parentSymbolName, startLine, endLine, partIndex, partsTotal, importsUsed, tokenCount, contentSha256, content`) |
| `dump-results --analysis-run <id>` o `--comparison <id>...` | base (solo lectura) | Un `<id>.json` por comparación COMPLETED con la forma de `RetrievalComparisonResultsResponse`. Las demás van a `manifest.json` como `omitted`. |
| `compare-dumps --a <jsonl> --b <jsonl> [--out <carpeta>]` | dos `chunks.jsonl` | Resumen por stdout (`identical`, recuentos). Sale con 1 si hay diferencias. Con `--out`, `comparacion.json`. |
| `sample --dump <jsonl> --seed <texto> [--calibration 3] [--reserve 3] [--official 12] [--exclude <archivo>] [--repo <nombre>]` | `chunks.jsonl` | `universe.csv`, `eligible.csv`, `sample.csv` (`role,order,repo,filePath,qualifiedName,kind,closureSize,closureTypes`), `sample.json` (parámetros, semilla, algoritmo, primeras 5 salidas crudas en hex, recuentos). |
| `support-files --sample <csv> --checkout <carpeta>` | `sample.csv` + checkout (solo lectura) | Copias con la línea `// oe2-support` al final, `support-manifest.json` (SHA-256 antes, de la copia y después; el checkout no cambia). |
| `pool --dump <jsonl> --sample <csv> --results <carpeta> --seed <texto> --guide <guia.md> [--max-chars 6000] [--roles <lista>]` | volcado, sample, resultados y guía | `ciego/GUIA.md` (copia de los bytes de la guía), `ciego/hojas/T<nn>.md`, `ciego/annotation-template.csv`, `clave/key.json` y `pool-summary.csv`. **`--guide` es obligatorio** (sin él, uso incorrecto: sale con 2). |
| `score --results <carpeta> --gt <gt.json> --gt-sha256 <hex> --sample <csv> [--include-calibration] [--roles <lista>]` | resultados, GT y sample | `metrics-per-target.csv` (solo oficiales) y `scores.json` (solo oficiales). Con `--include-calibration`, la calibración y la reserva van solo a `metrics-calibracion-reserva-NO-REPORTABLE.csv` (marcado «no reportable»), nunca a `scores.json`. |
| `build-gt --template <plantilla adjudicada.csv> --key <key.json> --sample <csv> --sheets <carpeta ciego/hojas> [--roles oficial]` | plantilla adjudicada, llave, sample y hojas `ciego/hojas/` del paquete entregado (solo lectura, sin base) | `gt.json` (forma que lee `score`), `gt.sha256` (SHA-256 de los bytes de `gt.json`, formato `sha256sum`), `gt-summary.csv` (por target: candidatos, relevantes, no relevantes), `manifest.json` (SHA-256 de entradas y salidas). |

### Guía de anotación, roles y verdad de terreno (WI-CORE-108)

- **Quién redacta qué.** La guía de anotación (criterios de relevancia R1…R5) la redacta y congela el **equipo investigador**; la tool **solo la copia** (`pool --guide`) sin modificarla, byte a byte (también CRLF y bytes no UTF-8). Su SHA-256 y su tamaño van al manifiesto de `pool`, y la hoja lo referencia (`ciego/GUIA.md`, desde `ciego/hojas/`) para que quede claro qué versión se usó.
- **Hoja neutra.** La introducción de cada hoja es un puntero: «Para cada candidato, registra tu decisión y el criterio según la guía `ciego/GUIA.md` (SHA-256 …). Usa solo esta hoja y la guía.». No define relevancia. La hoja y la plantilla siguen sin modo, rank, score, relación ni origen (ceguera de WI-CORE-107, intacta).
- **Aviso sobre la guía.** Si la guía contiene términos de procedencia (`SE`, `SEM`, `rank`, `score`, `estructural`, `IMPORTS`, `seleccionado`, `origen`…), `pool` lo señala en stdout para que el equipo lo revise antes de distribuirla. La tool **no** la modifica ni bloquea por eso. La palabra «relación» no se marca por sí sola, porque es habitual en español.
- **Vocabulario de la plantilla (solo documentado aquí; las columnas no llevan texto adicional).**
  - `adjudicacion`: `relevante` o `no relevante`. Se normalizan espacios (incluidos internos) y mayúsculas. Cualquier otro valor o vacío es un error de `build-gt`.
  - `adjudicacion_criterio`: `R1`…`R5`, varios separados por `;` o `,`. Obligatorio para `relevante`; si se rellena en `no relevante` también se valida. Admite minúsculas.
  - Los criterios R1…R5 (su significado) están en la guía del equipo, no en la tool.
- **`--roles <lista>`** en `pool`, `score` y `build-gt`: valores `calibracion`, `oficial`, `reserva`, separados por comas, sin duplicados (se ordenan en ese orden canónico). Sin el flag: todos los roles en `pool` y `score`; `oficial` en `build-gt`.
  - `pool`: las filas fuera de la selección no necesitan comparación y no generan hoja, plantilla, resumen ni llave. Las hojas se numeran `T01…` en el orden del sample filtrado. El manifiesto registra `rolesSelected`, `targets` y `targetsInSample`.
  - `score`: restringe qué filas se puntúan. Las reglas de «solo oficiales en `scores.json`» y de `--include-calibration` no cambian. Si la selección no tiene oficiales, se avisa.
  - Un rol pedido que no tiene filas en el sample se avisa por stdout (`AVISO`), y el código de salida es 0 mientras quede al menos una fila. La selección completa sin filas sigue siendo uso incorrecto (2).
  - La selección solo cambia qué filas se procesan: el orden de candidatos y los `candidate_id` de un target son los mismos con o sin `--roles` (lo comprueba una prueba).
  - Rol desconocido, lista vacía o elemento vacío, o una selección sin filas en el sample: **uso incorrecto (2)**. El mensaje no repite el valor recibido.
- **`build-gt`, validación estricta.** Antes de escribir nada, comprueba: que todas las filas de los targets seleccionados tienen `adjudicacion` válida; que los criterios de los relevantes son válidos; que cada `candidate_id` existe en la llave y su `target_id` coincide; que no hay duplicados; que todo candidato de la llave de un target seleccionado tiene fila adjudicada; y que cada target seleccionado está en la plantilla y en la llave. **Todos** los problemas se acumulan y el error lista **todos** los ids (no solo el primero); no se genera ningún archivo. Las filas de targets no seleccionados se validan en su identidad, no se exige su adjudicación, y se cuentan en el manifiesto (`templateRowsOfUnselectedTargets`).
- **`--sheets <carpeta ciego/hojas>` (obligatorio; M-1).** Los `candidate_id` (`<targetId>-NN`) son posicionales: dependen de la semilla. Una llave de otra ejecución de `pool` tiene los mismos ids y pasaría cualquier validación de la plantilla. Por eso `build-gt` lee las hojas que vieron los anotadores (`ciego/hojas/T<nn>.md`, el formato de `renderSheet`) y comprueba, para cada target seleccionado, que cada `candidate_id` de la llave aparece en su hoja con el mismo `filePath` y `qualifiedName`, y que no sobra ni falta ningún candidato. Cualquier discrepancia aborta con la lista completa y no escribe nada. El lector ignora lo que está dentro de bloques de código (un `###` o un «- Archivo:» dentro del código no cuenta) y acepta CRLF. La llave debe ser la del mismo paquete que se distribuyó a los anotadores. Sin `--sheets`, uso incorrecto (2). El manifiesto registra el SHA-256 y el tamaño de cada hoja leída (`sheets`).
- **Filas en blanco.** Las filas totalmente en blanco al final de la plantilla (las añade una hoja de cálculo) se ignoran y se cuentan (`templateBlankRowsIgnored`). Una fila parcialmente rellena, o una en blanco en medio, sigue siendo un error con su número de fila.
- **Forma de `gt.json`.** `{ "<targetId>": [ { "filePath": "...", "symbolQualifiedName": "..." } ] }`: claves y elementos ordenados por unidades de código, 2 espacios y salto final. Un target sin relevantes queda con `[]`, y `score` lo trata como `NA`. Mismas entradas, mismos bytes.
- **Flujo completo:** `pool` (con `--guide` y, si procede, `--roles`) → el anotador rellena `ciego/annotation-template.csv` → `build-gt` con la plantilla adjudicada, `clave/key.json` del mismo paquete y `--sheets ciego/hojas` de ese mismo paquete → `score --gt gt.json --gt-sha256 <hash de gt.sha256>`. La carpeta `clave/` no sale de la tool.

### Reglas que fija el CLI

- **Elegibilidad ex ante (sin retrieval):** METHOD y FUNCTION (los CONSTRUCTOR y los tipos no son targets); archivo PHP que no es de prueba (`isTestFile`) ni de directorio ignorado; partes completas; firma con cuerpo; cierre estático de profundidad 1 no vacío; no excluido por `--exclude` (`filePath::qualifiedName`, una por línea). El motivo de exclusión queda en `universe.csv`.
- **Cierre de profundidad 1** (`closure.mjs`, compartido por `sample` y `pool`): tipos CLASS/INTERFACE/TRAIT/ENUM del volcado que (a) están en `importsUsed` (sin `\` inicial), o (b) comparten namespace y su nombre corto aparece como palabra completa, o (c) aparecen como `\FQCN` seguido de un carácter que no es de identificador (o fin de texto; igual que R-PHP4). Se excluye la clase declarante. `pool` recalcula el cierre y falla si no coincide con `sample.csv`.
- **Sorteo:** semilla = primeros 32 bits big-endian de SHA-256 de la semilla (UTF-8); generador mulberry32 (`state = (state + 0x6D2B79F5) | 0`, mezcla con `Math.imul`, salida `(t ^ (t >>> 14)) >>> 0`); barajado de Fisher–Yates descendente sobre la lista ordenada por `(filePath, qualifiedName)` con comparación por unidades de código. Roles por posición: calibración, oficiales, reserva. Si faltan elegibles, se usan todos y se advierte; no se relajan criterios.
- **Pool:** candidatos `selected` de SE ∪ SEM ∪ declaración de cada tipo del cierre, deduplicado por `(filePath, symbolQualifiedName)`, sin el propio target. Un candidato CONSTRUCTOR (`Clase.constructor`) seleccionado en SE o SEM se resuelve a su código igual que un método; CONSTRUCTOR sigue fuera del universo de `sample`. El orden de las hojas y de `candidate_id` depende solo de la semilla y de la identidad del candidato, nunca de su procedencia (SE, SEM o cierre). Se comprueba la configuración congelada (SE: `semanticTopK 20`, `finalTopK 10`, pesos 0.7/0.3; SEM: sin pesos; `embeddingModel` solo se registra). El barajado por target usa SHA-256(semilla + `|` + targetId); `candidate_id` = `<targetId>-<k:02d>`.
- **Ceguera:** `ciego/` (hojas, plantilla y `GUIA.md`) no contiene modo, rank, score, relación estructural ni origen que haya generado la tool; eso va solo en `clave/key.json`. La carpeta `ciego/` es la única que se entrega a los anotadores. `pool-summary.csv` es agregado y no es ciego. El contenido de `GUIA.md` lo escribe el equipo (ver la sección de WI-CORE-108): la tool solo avisa de términos de procedencia.
- **Score:** GT validada contra `--gt-sha256` (si no coincide, no se puntúa). P@k y R@k con k fijo (5 y 10); hits = elementos distintos de la GT recuperados. Un target sin GT o con GT vacía es `NA`. Antes de puntuar se re-rankea cada modo con la copia de `rankComparisonCandidates`; si los `rank`, `chunkId`, `selected` o `combinedScore` no coinciden, sale con 1. **Sensibilidad** (solo SE, no cambia el producto): re-orden por score combinado desc, semántico desc, `(filePath, symbolQualifiedName)` asc y `rank` original como último criterio; se reportan ΔP/ΔR frente al SE persistido.
- **Paridad:** `product-copies.mjs` (métricas, ranking, nombres calificados, `isTestFile`, `isIgnoredPath`, regex R-PHP3/R-PHP4, fórmula combinada) tiene pruebas de paridad contra el producto en `oe2/product-parity.spec.ts`.

### Limitaciones y decisiones tomadas donde la especificación dejaba margen

- El escáner de firma PHP (`php-signature.mjs`) no es un parser: no interpreta heredocs ni nowdocs; ignora comentarios, cadenas y atributos `#[...]`.
- Solo se consideran archivos `.php` como elegibles (el cierre es PHP). Los símbolos con partes faltantes o repetidas se marcan `partes-incompletas`; un candidato del pool con partes incompletas aborta.
- Si un mismo (archivo, nombre) tiene varios grupos de chunk, la hoja usa el de mayor precedencia (METHOD, FUNCTION, tipos, CONSTRUCTOR) y se cuenta en `ambiguousKinds`.
- Los candidatos del pool sin `symbolQualifiedName` no tienen identidad: se excluyen y se cuentan en `nSinIdentidad`.
- Las rutas de salida de los paquetes siguen la restricción del extractor (segmentos `[A-Za-z0-9._-]`); un archivo con otros caracteres en la ruta aborta `support-files`.
- `support-files` no admite `--out` dentro del checkout.
- El código de cada candidato se trunca a `--max-chars` (6000 por defecto; la decisión de subirlo la toma cross) con un marcador explícito en la hoja, que indica cuántos caracteres se muestran y cuántos tiene el original. El truncado afecta sobre todo a candidatos de tipo, cuya declaración completa (la clase) suele superar el límite: el anotador ve la cabecera y parte del cuerpo. El manifiesto de `pool` cuenta los bloques truncados (`truncatedBlocks`) y los de tipo (`truncatedTypeCandidates`).
- `sample` escribe `repo` vacío si no se pasa `--repo`.
- Sin estadística inferencial (κ, bootstrap, Wilcoxon): se hace fuera del CLI.

### Pruebas

```bash
DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run scripts/oe2
```

Usan fixtures sintéticos (PHP inventado, sin datos reales) y un doble del driver de PostgreSQL. No se conectan a ninguna base ni a red. Las pruebas de la paridad comparan con el código del producto.

WI-CORE-108 añade `guide-roles.spec.ts` (copia de bytes de `--guide`, puntero neutro, ceguera con guía de prueba, aviso de términos, `--roles` en `pool` y `score`, errores de uso), `build-gt.spec.ts` (forma de `gt.json`, validación estricta, normalización, determinismo, salidas, comprobación de hojas de `--sheets` con llave de otra semilla, candidatos extra o faltantes y bloques de código con `###`, filas en blanco) y `e2e-gt.spec.ts` (`pool` → plantilla adjudicada → `build-gt` → `score` con su `--gt-sha256`). Los fixtures comunes están en `oe2/wi108-fixtures.mjs`.

**Limitaciones de WI-CORE-108:** la guía no es verificable por la tool más allá de los términos de procedencia que avisa; el acuerdo entre anotadores (κ) no está en la tool; `build-gt` no interpreta el criterio de relevancia, solo valida su vocabulario; `--max-chars` sigue siendo una decisión de cross.
