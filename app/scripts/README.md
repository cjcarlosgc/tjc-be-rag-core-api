# Scripts de `app/scripts`

Herramientas del repositorio que no forman parte del producto (no entran en `dist`, ni en `oxlint`, ni en el build).

| Script | Qué hace |
|---|---|
| `generate-contract-types.mjs` | Genera o verifica los tipos de contratos (`pnpm contracts:generate` / `pnpm contracts:check`). |
| `local-php-env.mjs` | Genera los `.env` locales para probar PHP en local. |
| `extract-evidence.mjs` | Extractor de evidencia de solo lectura (WI-CORE-094). Ver abajo. |

## Extractor de evidencia (`extract-evidence.mjs`)

Lee, de la base de desarrollo y de Storage, lo que el producto **ya persistió** de un AnalysisRun y/o un ExperimentRun, y lo escribe en una carpeta con JSON y CSV. No modifica nada: no escribe en la base, no crea roles, no aplica migraciones y no escribe en Storage.

### Uso

Desde `tjc-be-rag-core-api/app`:

```bash
npm run evidence:extract -- --out <carpeta> [--analysis-run <id>] [--experiment <id>] [--include-pii] [--allow-out-in-repo]
# o directamente:
node scripts/extract-evidence.mjs --help
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
| `experiment.json`, `repetitions.csv` | Experimento (`modelConfig` sin `endpoint`, `budget`, semilla, pares), repeticiones, intentos, tokens, tiempos y verificaciones. |
| `tests/<estrategia>/<repetición>-<intento>.<ext>` y `.meta.json` | Bytes **exactos** de `testContent` tal como están en la base, sin redactar, con su verificación. |
| `sandbox-evidence.json` | **Copia redactada** de la evidencia del Sandbox y del reporte del runner. Los hashes persistidos se verifican sobre la base; los de la copia son independientes. |
| `context-traces.json` | Trazas de contexto tal como se persistieron (fragmentos de hasta 2000 caracteres). |
| `tabla70-autofill.json` | Solo las columnas automáticas de la Tabla 70 (Fecha, Proyecto/snapshot/Run y Tipo parcial); el resto queda manual. |

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
- El manifiesto no puede probar su propia integridad (ver `manifest.sha256`).
