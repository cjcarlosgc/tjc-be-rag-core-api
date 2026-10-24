# WI-CORE-094 — verificaciones técnicas
Modelo: implementer-high · configurado claude-sonnet-5-5 · atendido claude-haiku-5-5 · esfuerzo high

Nota: el modelo configurado para este rol era claude-sonnet-5-5; la sesión que ejecutó el trabajo corre sobre claude-haiku-5-5. Lo declaro tal cual para que la revisión independiente lo tenga en cuenta.

## 1. Alcance ejecutado

Extractor de evidencia de solo lectura en `app/scripts/` (script + módulos + pruebas + documentación), según `harness/reports/wi-core-094-scope.md`. Sin cambios en `app/src/**`, contratos, esquema Prisma, migraciones, `harness/state.json`, `harness/work-items.json`, `tasks.md`, otros repos ni `feature/esc-mod-01`. Sin dependencias nuevas (`app/package.json` solo gana el script `evidence:extract`). No se hizo commit ni push. No se leyó ningún `.env`. No se conectó a ninguna base ni a Storage.

Archivos:
- `app/package.json` (script `evidence:extract`)
- `app/scripts/extract-evidence.mjs` (CLI)
- `app/scripts/README.md` (uso, variables, qué escribe, qué no contiene, verificación de hashes, limitaciones)
- `app/scripts/evidence-extractor/` (16 módulos `.mjs`: `options`, `util`, `redaction`, `uuid`, `sql-guard`, `queries`, `session`, `storage`, `pii`, `hashes`, `trace`, `analysis`, `experiment`, `tabla70`, `package`, `index`; y 9 pruebas `.spec.ts`)
- `CHANGELOG.md` (entrada WI-CORE-094 en `[Unreleased]`)
- `harness/reports/wi-core-094-technical-checks.md` (este informe)

## 2. Comandos y resultados

| Comando (desde `app/` salvo indicación) | Resultado |
|---|---|
| `npx vitest run scripts/evidence-extractor` | 9 archivos, **139 pruebas pasan** |
| `npm test` (suite completa) | **170 archivos pasan, 2921 pruebas pasan, 104 omitidas**. Línea base de la rama: 2782 pasan y 104 omitidas; la diferencia (+139) corresponde exactamente a las pruebas nuevas. Exit 0. |
| `npm run lint` (`oxlint src/ test/`) | Exit 0. **No cubre `app/scripts/`** (decisión pendiente, ver §6). |
| `npm run lint:types` | Exit 0 (no cubre `app/scripts/`). |
| `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public npm run build` | Exit 0 (`prisma generate` + `nest build`). |
| `npm run contracts:check` | Exit 0. |
| `node scripts/sdd-check.mjs` (raíz del repo) | `SDD check OK`, exit 0. |
| `node scripts/extract-evidence.mjs --help` | Exit 0, sin credenciales. |
| `node scripts/extract-evidence.mjs --out <x>` (sin id) / sin `--out` | Exit 2 con error de uso. |
| Sin `DATABASE_URL` | Exit 1: `falta DATABASE_URL en el entorno…`. |
| `DATABASE_URL` apuntando a un puerto cerrado (127.0.0.1:1, sin datos) | Exit 1: mensaje genérico `no se pudo iniciar la transacción…`. La URL de prueba no aparece en stdout ni stderr. |
| `git status` | Solo `CHANGELOG.md`, `app/package.json` (modificados) y `app/scripts/README.md`, `app/scripts/extract-evidence.mjs`, `app/scripts/evidence-extractor/`, este informe (nuevos). Sin `app/src`, sin esquema, sin harness. |

## 3. Mutaciones (pruebas que deben fallar)

Copia en `scratchpad/mut/app` (fuera del repositorio), mismas pruebas, una mutación por ejecución; la copia se restauró y quedó idéntica al original (`diff -r` sin diferencias).

| Mutación | Pruebas que fallan |
|---|---|
| M1: quitar `SET TRANSACTION READ ONLY` | 3 |
| M2: aplicar la redacción al contenido del test | 2 |
| M3: imprimir `DATABASE_URL` en el README del paquete | 16 |
| M4: no anonimizar la PII por defecto | 3 |
| M5: hash que siempre coincide | 3 |
| M6: quitar el `ROLLBACK` final | 4 |
| M7: permitir `--out` dentro del repositorio | 3 |

## 4. Decisiones de diseño

1. **Driver sin `pg` directo.** `openPrismaPgDriver` usa `PrismaPg` de `@prisma/adapter-pg` (dependencia directa): `connect()` → `startTransaction()` (el adaptador emite `BEGIN`) → `SET TRANSACTION READ ONLY` como primera sentencia → solo consultas registradas → `ROLLBACK` explícito por SQL en `finally` (ver §9, SEC-01). No usa el cliente generado de Prisma (es TypeScript y `dist/` exige build).
2. **Guardia de SQL** (`sql-guard.mjs`, endurecida en §9 / SEC-02): segunda barrera. Rechaza más de una sentencia, todo lo que no empiece por `SELECT`/`WITH`, palabras de escritura o control, `FOR UPDATE`, `INTO`, `$` no posicional, barras invertidas, `E''`/`U&`, y llamadas fuera de una lista blanca. Las sentencias de control se limitan a una lista cerrada (`SET TRANSACTION READ ONLY`, `ROLLBACK`). La barrera real es la transacción READ ONLY.
3. **Consultas constantes** (`queries.mjs`): identificadores camelCase entre comillas dobles (R-05), parámetros `$1`/`$2` y ninguna interpolación de valores. Las comprobaciones inversas usan `<>` (y `<@` para `proposalIds`), con `count(*)`; el chequeo de `storageKey` usa `CAST($2 AS TEXT)` para evitar ambigüedad de `length` en PostgreSQL.
4. **Migraciones y esquema.** Se sondean tablas con `to_regclass` y columnas con `information_schema`, por grupos (`experimentCore`, `experimentTrial`, `repetitionArtifacts`, `analysisRun`), más el registro en `_prisma_migrations`. Lo que falta se declara como ausencia en el manifiesto. Si falta el grupo de un run o experimento pedido explícitamente, el extractor termina con error (exit 1) sin escribir nada. Si la migración de trial falta, se declara y se omiten las partes que dependen de ella.
5. **Redacción en copia aparte.** `redaction.mjs` replica `redactSecretsInText` del producto. La prueba `parity.spec.ts` compara ambas sobre un corpus y en idempotencia; falla si divergen. Solo se aplica a la copia de `sandbox-evidence.json`. Los tests se escriben con los bytes de `testContent`.
6. **Verificación de hashes** (`hashes.mjs`): `testContentSha256` sobre el texto persistido (sin truncado); `artifactHash` sobre el texto persistido con nota de NUL; `runnerReportSha256` y `sandboxEvidenceSha256` con JSON canónico (copia de `canonicalJson`); `contentSha256` sobre los bytes descargados; `promptSha256` siempre `no verificable`. Un valor persistido nunca se corrige.
7. **UUID v5** (`uuid.mjs`) para `snapshotRef` de la Tabla 70: paridad probada con `uuidV5` y `snapshotRefFor` del producto.
8. **Storage** (`storage.mjs`): cliente propio de `@supabase/supabase-js`, solo `download`, con `persistSession: false`. No reutiliza el adaptador del producto (que crea buckets). Un error de descarga no expone el texto del proveedor.
9. **PII** (`pii.mjs`): `actorLogin`, `baseRef`, `headRef`, `branchName` y `companionPullRequestUrl` se sustituyen por `anon-` + 16 hex de HMAC-SHA256 con sal fija `tjc-core-evidence-package/v1`; `prTitle` se omite. `--include-pii` los incluye y el manifiesto lo registra. La anonimización es seudonimización (ver README, limitaciones).
10. **Carpeta de salida** (`package.mjs`): se resuelven enlaces simbólicos del ancestro existente; se rechaza dentro del repositorio salvo `--allow-out-in-repo`; se rechaza si existe y no está vacía. El paquete se construye en memoria y se escribe al final con `wx`.
11. **Trace de 9 enlaces** (`trace.mjs`): sentido directo con `PRESENT` / `NOT_APPLICABLE`; chequeo inverso con 7 consultas, `PRESENT` si 0 filas que rompen el enlace, `INCONSISTENT` si hay filas, `NOT_APPLICABLE` si no hay filas de origen. No verifica PR/HEAD contra GitHub.
12. **Otros.** `endpoint` se omite de `modelConfig` (queda constancia en `experiment.json`). Los mensajes de error se sanean con los valores de `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY` y no muestran pila. El CSV neutraliza celdas que empiezan por `= + - @`. Las pruebas usan `os.tmpdir()` solo en las que escriben a disco y lo borran al terminar.

## 5. Qué NO se pudo verificar

- **Nada contra datos reales.** No se ejecutó ninguna consulta contra la base de desarrollo ni contra Storage. Todas las pruebas usan dobles.
- **Sintaxis PostgreSQL de las consultas no comprobada por un motor.** Los dobles no interpretan SQL. Intenté un analizador SQL sin conexión para validar la sintaxis, pero la instalación del paquete fue denegada y no la reintenté. Riesgo residual: una consulta mal formada solo aparecerá al ejecutar el extractor (fallaría con error, sin escritura parcial).
- **Comportamiento del adaptador real.** Supuestos verificados en el código de `@prisma/adapter-pg` 7.10.0: JSON/JSONB llegan como texto (se parsean en `mapRows`); `text[]` llega como array; las marcas de tiempo llegan como texto ISO; `startTransaction()` emite `BEGIN`. No probado contra PostgreSQL.
- **Hashes sobre JSONB real.** La recomputación de `runnerReportSha256` y `sandboxEvidenceSha256` supone que el JSON devuelto por PostgreSQL reproduce el canónico original. Verificable solo contra datos reales.
- **Descarga real de Storage.** El mapeo de «no encontrado» (`statusCode` `'404'` o «not found») es un supuesto.
- **Lint y tipos de `app/scripts`.** `oxlint` y `lint:types` no cubren la carpeta; los `.mjs` solo tienen `node --check` y pruebas. Los `.spec.ts` importan `.mjs` sin declaraciones de tipos (no hay `tsc` sobre `scripts`).
- **Revisión independiente.** No hecha: queda al `reviewer` (foco en seguridad: guardia SQL, redacción, PII, salida). No me autoapruebo.

## 6. Decisiones pendientes del usuario

1. **Código de terceros en disco** (decisión 4 del scope, pendiente de confirmar): el paquete incluye tests generados y fragmentos de contexto de repositorios públicos.
2. **Lint de `app/scripts`** (R-01 del informe de WI-CORE-093): dejar fuera de `oxlint`, o ampliar `lint`.
3. **PII por defecto** (anonimizar/omitir, con `--include-pii` explícito): confirmar.
4. **Ejecución real**: la primera corrida contra la base de desarrollo la hace el usuario en su shell (`npm run evidence:extract -- --out …`).

## 7. Consultas SELECT para validar los ⚠ del análisis (las ejecuta el usuario; no se ejecutaron)

```sql
-- 1) Migraciones de evidencia (R-04)
SELECT "migration_name", "finished_at" FROM "_prisma_migrations"
 WHERE "migration_name" IN ('20261013100000_experiment_repetition_artifacts', '20261013110000_experiment_trial_reconstruction');

-- 2) Qué kinds y stages etiqueta el Sandbox (¿hay composer?)
SELECT e->>'kind' AS kind, e->>'stage' AS stage, count(*)
  FROM "experiment_repetition_artifacts" a, jsonb_array_elements(a."sandboxEvidence"->'entries') e
 GROUP BY 1, 2;

-- 3) Cobertura de una corrida (sustituir <EXPERIMENT_ID>)
SELECT count(*) FILTER (WHERE a.id IS NULL) AS sin_artefacto,
       count(*) FILTER (WHERE a."sandboxEvidence" IS NULL) AS sin_evidencia,
       count(*) FILTER (WHERE a."testContentTruncated") AS truncadas
  FROM "experiment_repetitions" r
  LEFT JOIN "experiment_repetition_artifacts" a ON a."repetitionId" = r.id
 WHERE r."experimentId" = '<EXPERIMENT_ID>';

-- 4) Vínculos de experimentos recientes
SELECT id, "analysisRunId", "commitSha" FROM "experiment_runs" ORDER BY "createdAt" DESC LIMIT 20;
```

## 8. Próximo paso recomendado

Revisión independiente del `reviewer` sobre el diff de WI-CORE-094 (foco: guardia SQL y transacción READ ONLY, redacción en copia, PII, escritura de salida, ausencia de secretos). Después, decisión del usuario sobre los puntos 1 a 4 de §6. No hay commit ni push.

## Re-ejecución del leader (2026-10-24)

Desde `app/` con Node 22: `npm run lint` (exit 0; no cubre `app/scripts`), `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public npm run build` (exit 0), `npm run contracts:check` (limpio) y `npm test`: 170 archivos pasan y 7 omitidos; 2921 tests pasan y 104 omitidos (2782 previos + 139 nuevos). `node scripts/extract-evidence.mjs --help` funciona sin credenciales. `git status`: `app/package.json` (solo el script `evidence:extract`), `CHANGELOG.md`, `app/scripts/extract-evidence.mjs`, `app/scripts/README.md`, `app/scripts/evidence-extractor/` y los informes del WI; sin cambios en `app/src`, `app/prisma`, `spec/contracts` ni `app/pnpm-lock.yaml`. Barrido del leader: el script no carga `.env` (solo recibe `process.env` en `main`) y los únicos `console.*` de `app/scripts` previos al WI son de otros scripts. Nada se ejecutó contra una base real ni contra Storage.

## 9. Ciclo de corrección tras la revisión de seguridad (ciclo 1 de 2)

Fuente: `harness/reports/wi-core-094-independent-review.md` (veredicto CHANGES_REQUESTED). Se verificó cada punto contra el código antes de aplicarlo; todos los hallazgos se sostuvieron.

### 9.1 Cambios por hallazgo

| Hallazgo | Estado | Cambio | Prueba |
|---|---|---|---|
| SEC-01 (media) ROLLBACK no enviado | Aplicado | `session.mjs`: tras la consulta o el error se envía `ROLLBACK` por `executeRaw` (lista cerrada: `SET TRANSACTION READ ONLY` y `ROLLBACK`); después `transaction.rollback()` (solo libera el cliente) y `dispose()` (pool.end). Si el ROLLBACK SQL falla, se libera igual y se propaga el error de la lectura. El doble de `session.spec.ts` ya no trata `rollback()` como ROLLBACK: lo registra como `release`. Manifiesto y comentarios describen esa secuencia. | `session.spec.ts` (12): secuencia exacta, sin COMMIT, ROLLBACK ante error, ROLLBACK fallido. |
| SEC-02 (baja/media) guardia evadible | Aplicado (ambas capas) | `sql-guard.mjs`: barras invertidas rechazadas en todo el texto; prefijos `E`, `B`, `X`, `U&` rechazados; nombres entrecomillados examinados (prefijo `pg_`/`lo_`/`dblink`, palabras prohibidas, llamadas); llamadas solo a `count`, `left`, `length`, `cast`, `array`, `to_regclass`; `EXPLAIN`, `SECURITY`, `OWNER` en la lista prohibida. Además `session.mjs` solo envía textos registrados en `queries.mjs` (`approvedSqlTexts()`). README: la guardia es segunda barrera, la real es READ ONLY. | `sql-guard.spec.ts` (62): 24 PoC rechazados (incluidos los de la revisión), escape con barra y `U&` rechazados, consultas reales aceptadas (todas las registradas). |
| SEC-03 (baja) permisos 0644/0755 | Aplicado | `package.mjs`: `mkdir` con `mode: 0o700` y `writeFile` con `mode: 0o600` (la umask no añade bits). | `package.spec.ts`: `fs.statSync` comprueba `mode & 0o077 === 0` y `0o600` en archivos, `0o700` en carpetas anidadas. |
| SEC-04 (baja) M10 y M14 sobrevivían | Aplicado | (a) `storage.spec.ts`: cliente tipo Proxy que solo acepta `storage.from().download`; cualquier otra propiedad lanza. (b) `cli.spec.ts`: procesos reales con `spawnSync` y un puerto cerrado; marcadores en la contraseña y en la clave de Storage; comprueba stdout+stderr en `--help`, argumentos inválidos, base inalcanzable y sin `DATABASE_URL`. | Ver §9.3 (M10 y M14 ahora caen). |
| SEC-05 (baja) `..` aborta la extracción | Aplicado | `util.mjs` `fileStem`: colapsa `..` a `.` y sanea sin lanzar. | `util.spec.ts`: `Foo..bar` → `Foo.bar`; prueba de extremo a extremo con `qualifiedName` `Foo..bar` (`generated-tests/01-Foo.bar.php`). |
| SEC-06 (baja) PII residual | Declarado (no redactado) | `pii.mjs`: `PII_RESIDUAL_FIELDS` y nota sobre `repositoryName`+`prNumber`; aparece en `manifest.json` → `piiPolicy.piiResidual`; README con la lista. No se cambió el comportamiento por defecto ni se añadió una copia redactada de los textos libres. | `extraction.spec.ts`: el manifiesto declara `test_publications.failureMessage` y la nota. |
| SEC-07 (baja) Storage sin prefijo ni tope | Aplicado | `index.mjs`: clave fuera de `analysis-runs/<runId>/proposals/` → `outside_prefix`, no se descarga. `storage.mjs`: tope `maxBytes` (por defecto 5 MiB, `--storage-max-bytes`, máximo 64 MiB); `too_large` si el Blob o el buffer lo superan; el tope se mira antes de bufferizar cuando el SDK informa el tamaño. Manifiesto: `storage.maxObjectBytes`, `objectsSkippedByPolicy`. | `storage.spec.ts` (tope antes de bufferizar), `extraction.spec.ts` (clave fuera de prefijo no descargada; tope declarado), `pii-options.spec.ts` (opción). |
| SEC-08 (baja) saneado solo por valor completo | Aplicado | `util.mjs` `sensitiveValuesFrom`: variables completas y usuario, contraseña (en bruto y decodificada) y host de `DATABASE_URL` y `SUPABASE_URL`; `scrubSecrets` ordena de más largo a más corto. Sin longitud mínima (solo se ignoran valores vacíos): se sustituyen también valores cortos en mensajes de error, con el coste de alguna sustitución indeseada. | `util.spec.ts` (DSN, contraseña citada, URL malformada) y `cli.spec.ts`. |
| DOC-01 (baja) manifiesto sin hash propio y `sandbox-evidence.json` con entrada vacía | Aplicado | `package.mjs` escribe `manifest.sha256` (sello de `manifest.json`); excepción declarada en el manifiesto (`manifestSeal`) y en el README: el sello debe sellarse externamente para probar integridad. `experiment.mjs`: `normalizeArtifact` pone a null los campos ausentes; sin migración trial no hay entradas vacías. | `package.spec.ts` (sello), `extraction.spec.ts` (sin entradas vacías sin trial). |

### 9.2 Números reales (desde `app/`)

- `npm run lint`: exit 0. `npm run lint:types`: exit 0. `npm run contracts:check`: exit 0.
- `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public npm run build`: exit 0.
- `npm test`: exit 0. **Test Files 172 passed | 7 skipped (179); Tests 2981 passed | 104 skipped (3085).** Antes de esta corrección: 2921 pasan. La diferencia (+60) corresponde exactamente a las pruebas nuevas del extractor (139 → 199 casos).
- `npx vitest run scripts/evidence-extractor`: 11 archivos, **199 pruebas pasan**.
- `node scripts/sdd-check.mjs` (raíz): exit 0, «SDD check OK». `node scripts/extract-evidence.mjs --help`: exit 0.

### 9.3 Mutaciones nuevas (copia en scratchpad, fuera del repo; restaurada e idéntica al original)

| Mutación | Pruebas que fallan |
|---|---|
| M10: `storage.mjs` llama a `remove` antes de `download` | 5 |
| M14: la CLI imprime `DATABASE_URL` en el catch | 1 |
| M-RB: sin ROLLBACK explícito | 6 |
| M-G: reintroducir el escape `E''` (quitar el rechazo de barras invertidas) | 1 |
| M-G2: `query_to_xml` en la lista blanca de llamadas | 1 |
| M-APP: sin comprobación de consultas registradas | 1 |
| M-MODE: archivos `0644` | 1 |
| M-PFX: descargar claves fuera del prefijo | 1 |
| M-STEM: sin colapso de `..` en `fileStem` | 3 |
| M-SEAL: sin `manifest.sha256` | 4 |
| Control (sin cambio) | 0 (pasa) |

### 9.4 Límites que siguen abiertos

- El tope de Storage se aplica después de la transferencia: el SDK de Supabase no permite conocer el tamaño sin `list`/HEAD, que el extractor no usa.
- No se probó contra PostgreSQL real: el adaptador emite BEGIN, la secuencia de control y el texto de las consultas son supuestos verificados por lectura de código y por dobles. Un análisis SQL sin conexión sigue sin hacerse (la instalación del paquete fue denegada).
- SEC-06: los textos libres se declaran, no se redactan. Una redacción en copia cambiaría la evidencia que el usuario pidió (campos tal cual) y debe decidirse aparte.
- El manifiesto no se autoverifica: `manifest.sha256` debe sellarse externamente.
- `git status` muestra `harness/state.json` y `harness/work-items.json` modificados que no son de esta sesión (los registros del Harness). No se tocaron.
