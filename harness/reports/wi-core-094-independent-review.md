# WI-CORE-094 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: CHANGES_REQUESTED** (foco en seguridad). Ningún hallazgo permite escribir en la base ni filtrar credenciales hoy; los obligatorios cierran brechas entre lo que el código/README afirman y lo que ocurre de verdad, y pruebas que no detectan regresiones de seguridad. Revisado el árbol sin commit sobre HEAD 03cdf9c. No se leyó ningún `.env`, no hubo conexión a base ni a Storage; mutaciones y PoC en copia (`scratchpad/rv094`).

## Resumen por punto

| # | Punto | Resultado |
|---|---|---|
| 1 | Alcance | OK. `git diff --stat` sobre `app/src`, `app/prisma`, `spec`, `app/pnpm-lock.yaml`: vacío. `app/package.json` solo añade `evidence:extract` (línea 31). Resto: `app/scripts/**` nuevo, `CHANGELOG.md`, informes y registro del Harness (`state.json`, `work-items.json`). Sin dependencias nuevas. |
| 2 | Solo lectura | Parcial: ver SEC-01 y SEC-02. Primera sentencia tras BEGIN = `SET TRANSACTION READ ONLY` (`session.mjs:266-267`), todo `query` pasa por `assertReadOnlySql` (`session.mjs:232`), no hay otro camino de ejecución, parámetros posicionales (`session.mjs:236-240`), ids validados por `ID_PATTERN` (`options.mjs:369`; `uuid.mjs` no valida, solo calcula snapshotRef). |
| 3 | Secretos | OK en lo probado: ver evidencia. No hay `dotenv`/`.env`, `console.*` ni `JSON.stringify(error)`; Storage solo `download` (`storage.mjs:323`), cliente propio. Pero ver SEC-04 y SEC-08. |
| 4 | Salida | Rechazo en repo robusto (relativas, `..`, symlink, minúsculas/mayúsculas, repo mismo). Traversal imposible por `assertSafeSegment`. Falla: permisos (SEC-03), sin cota de memoria (SEC-07). |
| 5 | CSV | OK: `=`, `+`, `-`, `@`, TAB, CR se prefijan con `'` (`util.mjs:42-49`); comillas y saltos escapados. |
| 6 | Integridad | OK: el test se escribe con `Buffer.from(testContent,'utf8')` de la BD (`experiment.mjs:124`), sin redacción; hashes verificados sobre esos datos; NUL/truncado/ausente cubiertos; redacción solo en `sandbox-evidence.json` y CSV/JSON de errores. Manifiesto con SHA-256 de todos los archivos salvo sí mismo (README lo declara; ver DOC-01). |
| 7 | PII | Cumple lo prometido por defecto; hay residuos en texto libre (SEC-06). |
| 8 | SQL | Sin consultas sospechosas de ser incorrectas. Comprobé con un script (copia) que TODAS las columnas de `SCHEMA_GROUPS` existen en `schema.prisma` por tabla `@@map`; columnas Json declaradas en `json:` cubren todos los campos Json usados; `proposalIds` es `String[]` (text[]) y `id` String, por lo que `<@ ARRAY(SELECT ...)` es válido; `count(*)` bigint se convierte con `Number`. Riesgo residual solo verificable contra Postgres real: forma en que el adaptador devuelve jsonb (el código acepta texto y objeto) y `to_regclass('public.x')` fija el esquema `public`. |
| 9 | Pruebas | 21 mutaciones: 19 muertas, 2 sobreviven (SEC-04). |
| 10 | Gates | Ver evidencia. |
| 11 | Documentos | CHANGELOG exacto (139 casos verificado). README correcto salvo lo de ROLLBACK/guardia (SEC-01/02) y DOC-01. No pide pegar credenciales en el chat. |

## Hallazgos

### SEC-01 — Media — Nunca se envía `ROLLBACK`; la transacción se cierra solo por desconexión
- Ubicación: `app/scripts/evidence-extractor/session.mjs:270` (`transaction.rollback()`), manifiesto `index.mjs:257` («...; ROLLBACK»), prueba `session.spec.ts:21-22,46,63`.
- Prueba: `app/node_modules/@prisma/adapter-pg/dist/index.js:714-721` (v7.10.0): `PgTransaction.rollback()` solo hace `this.client.release()`; el `COMMIT`/`ROLLBACK` SQL lo emite el `TransactionManager` de Prisma (`client.js`: `el=()=>({sql:"ROLLBACK"...})`), que aquí no se usa. El cliente vuelve al pool con la transacción abierta y `dispose()` (`client.end()`, `index.js:827`) la cierra al desconectar. Es inocuo hoy (READ ONLY y proceso corto) pero contradice el manifiesto, el comentario de `session.mjs:3` y la garantía «siempre ROLLBACK». Además el doble de la prueba modela `rollback()` como ROLLBACK real y por eso no lo detecta.
- Debe hacer: antes de `transaction.rollback()` enviar `ROLLBACK` con `executeRaw` (permitido por una lista cerrada de sentencias de control: `SET TRANSACTION READ ONLY` y `ROLLBACK`, con `assertControlStatement` ampliado), también en la rama de error; y que el doble distinga `executeRaw('ROLLBACK')` de `rollback()` (liberar) y la prueba exija ambas. Si no se arregla, corregir manifiesto/comentario para decir «cierre por desconexión».

### SEC-02 — Baja/Media — La guardia SQL tiene evasiones demostradas
PoC (`assertReadOnlySql` devuelve true) en copia:
- `SELECT "pg_terminate_backend"(123)`, `SELECT "set_config"('a','b',false)`, `SELECT "nextval"('s')`, `SELECT "lo_import"('/etc/passwd')`, `SELECT pg_catalog."pg_terminate_backend"(1)`: los identificadores entre comillas se sustituyen por `""` antes de buscar `pg_|lo_|set_config|nextval` (`sql-guard.mjs:126-143,109-110`).
- `SELECT E'\'' ; DROP TABLE x; --'` y `SELECT E'\''; SELECT pg_terminate_backend(1); --'`: en cadenas `E'...'` el `\'` es una comilla escapada para Postgres pero la guardia cierra el literal ahí y ve el resto como contenido de cadena (`sql-guard.mjs:126-142`), así que el `;` posterior queda oculto. (Con protocolo extendido Postgres rechaza varias sentencias y la transacción READ ONLY bloquea DROP, pero la guardia no debe ser evadible.)
- `SELECT query_to_xml('update x set a=1',true,true,'')` pasa (ejecuta SQL arbitrario por dentro; solo la transacción READ ONLY lo frena), y `txid_current()`, `current_setting()` también.
- Alcance real: las consultas son constantes (`queries.mjs`), no hay entrada del usuario en el SQL, y la barrera efectiva es READ ONLY; por eso no es explotable hoy. Pero README «Garantías» y los comentarios venden la guardia como barrera de solo lectura.
- Debe hacer: rechazar `E'`/`e'`, `U&` y cualquier `"` seguido (con o sin espacios) de `(`; o, mejor, lista blanca de funciones/palabras (`count`, `left`, `length`, `to_regclass`, `ARRAY`, `CAST`) en lugar de lista negra; añadir a `sql-guard.spec.ts` los casos anteriores. Si se prefiere no endurecer, ajustar README/comentarios a «segunda barrera sobre consultas constantes; la garantía es la transacción READ ONLY».

### SEC-03 — Baja — Evidencia con permisos 0644/0755
- `package.mjs:128-132`: `mkdir`/`writeFile` sin `mode`; PoC con umask 022 → carpeta `40755`, archivo `100644`. El paquete puede contener código de terceros, evidencia del Sandbox y (con `--include-pii`) logins.
- Debe hacer: `mkdir(..., { recursive: true, mode: 0o700 })` y `writeFile(..., { flag: 'wx', mode: 0o600 })` (y cubrirlo con una prueba que compruebe `mode & 0o077 === 0`; ojo con `recursive` que solo aplica `mode` a los directorios creados). Sin atomicidad: un fallo a mitad deja una carpeta parcial que la siguiente ejecución rechaza (aceptable; documentarlo en el README o escribir en `<out>.partial` y renombrar).

### SEC-04 — Baja — Dos regresiones de seguridad no son detectadas por las pruebas
Mutaciones que sobreviven (139 verdes):
- M10: `storage.mjs` llama a `client.storage.from(bucket).remove([key])` antes de `download`. No existe prueba de `createSupabaseDownloader`; solo se prueba un descargador falso.
- M14: `extract-evidence.mjs` escribe `env.DATABASE_URL` por stderr en el `catch`. No hay prueba de la CLI (`main`), ni de `--help`, ni de que ninguna salida contenga el valor de las variables.
- Debe hacer: (a) prueba de `createSupabaseDownloader` con un cliente falso tipo `Proxy` que falle ante cualquier método que no sea `storage.from().download` y que verifique que `reason` no repite el texto del proveedor; (b) prueba de CLI con `child_process.spawnSync(process.execPath, [script, ...])` y `DATABASE_URL` con marcador hacia un puerto cerrado (como hice a mano: sale «no se pudo iniciar la transacción...» sin el marcador), comprobando stdout+stderr, y otra con `--help` y con argumentos inválidos.

### SEC-05 — Baja — `fileStem` puede abortar toda la extracción
- `util.mjs:75-81` conserva puntos; un `qualifiedName` con `..` (p. ej. `Foo..bar`) produce un segmento que `assertSafeSegment` rechaza (`util.mjs:85`) y se lanza `Error` en `plan.addBytes`, perdiendo todo el paquete. No hay escape de `--out` (la validación funciona), es robustez.
- Debe hacer: en `fileStem`, colapsar `..` (`.replace(/\.{2,}/g,'.')`) y probarlo.

### SEC-06 — Baja — PII residual en texto libre y seudonimización
- No pasan por la política: `test_publications.failureMessage` (puede incluir rama/URL), `analysis_runs.resultSummary`, `generated_test_proposals.failureSummary`/`generation`, `experiment_runs.failureMessage`, `analysis_contexts.omittedFunctionalRules`, `context-traces.json` (fragmentos de código de terceros) y `repositoryName` + `prNumber` (con ambos el `actorLogin` seudonimizado se recupera en GitHub). `redactCopy` solo se aplica a evidencia del Sandbox y `errorSummary`/`failure` de repeticiones.
- HMAC-SHA256 con sal pública constante, 16 hex: un diccionario de logins comunes se invierte al instante; ya está dicho en `pii.mjs:4-5` y README «Limitaciones», lo cual es aceptable como seudonimización declarada.
- Debe hacer: declarar en README y en `piiPolicy` de `manifest.json` la lista de campos de texto libre NO tratados y que `repositoryName`/`prNumber` identifican el PR público; opcional: pasar esos textos libres por `redactCopy` en una copia.

### SEC-07 — Baja — Storage sin cota ni validación de prefijo antes de descargar
- `index.mjs:149-154` descarga cada `proposal.storageKey` tal cual y `storage.mjs:329` bufferiza el objeto entero; el chequeo del prefijo del run solo se registra después (`proposalStorageKeyOtherRun`). Una clave fuera del prefijo se descarga igual (BD propietaria = fuente confiable, por eso baja).
- Debe hacer: no descargar y declarar ausencia si `storageKey` no empieza por `analysis-runs/<runId>/proposals/`; límite de tamaño (p. ej. 5 MiB) con ausencia declarada.

### SEC-08 — Baja — Saneado de errores solo por valor completo
- `util.mjs:66-72`/`extract-evidence.mjs:27-28`: solo se sustituyen `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY` completos. Un error posterior de driver (durante una consulta) que cite solo host o contraseña pasaría. Hoy los fallos de conexión/inicio se reemplazan por texto genérico (`session.mjs:254-265`), y las pruebas manuales con marcadores en URL, URL malformada y host de Storage no filtraron nada (0 apariciones).
- Debe hacer: añadir al conjunto a sanear el usuario, la contraseña y el host extraídos de `DATABASE_URL` y el host de `SUPABASE_URL`.

### DOC-01 — Baja — Manifiesto sin hash propio ni declaración interna
- `package.mjs:61-80`: `manifest.json` no está en `files` ni en `hashes.txt`; solo el README del repo lo dice. Añadir en el manifiesto `selfHash: 'excluido por diseño'` o equivalente, y en `index.mjs:257` corregir el texto de `readOnly.transaction` según SEC-01. Cosmético: en la variante sin migración `trial` `sandboxEvidence` queda `undefined` y `experiment.mjs:180` crea una entrada vacía en `sandbox-evidence.json`.

## Evidencia

- Gates desde `app/`: `npm run lint` sin errores ni avisos; `npm run lint:types` sin salida de error; `npm run contracts:check` OK; `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public npm run build` exit 0; `npm test`: Test Files 170 passed | 7 skipped (177), Tests **2921 passed | 104 skipped (3025)**; `node scripts/extract-evidence.mjs --help` imprime la ayuda, exit 0. Raíz: `sdd-check` «SDD check OK»; `validate-work-items` «passed (CORE, 93 WI)»; `validate-harness` «Harness V3 validation passed»; `validate-completions` «passed (90 completed WI)».
- Suite del extractor sola (copia): 9 archivos, 139 pruebas, sin base ni red.
- Mutaciones (copia, `vitest run scripts/evidence-extractor`): M1 sin `SET READ ONLY` → 3 fallos; M2 sin guardia en `query` → 1; M3 redactar el test → 2; M5/M5b sin anonimizar / `prTitle` no omitido → 2/2; M6 `--out` en repo permitido → 3; M7 traversal → 2; M8 hash siempre coincide → 3; M9 sin neutralizar CSV → 1; M11 SHA del manifiesto constante → 2; M12 sin rollback → 4; M13 carpeta no vacía permitida → 1; M15 scrub desactivado → 1; M16 incluir PII siempre → 3; M17 hash con dato alterado → 2; M18 truncado no marcado → 2; M19/M20/M21 guardia sin palabras/`;`/INTO → 1 cada una. **Sobreviven M10 (Storage con `remove`) y M14 (imprimir `DATABASE_URL`).** Las pruebas son sustantivas; no vi vacuosas, salvo que el doble de `rollback()` (SEC-01) modela algo que el adaptador real no hace.
- Guardia: rechazadas múltiples sentencias, comentarios `--` y `/* */` (también anidados), `WITH ... DELETE`, `SELECT INTO`, `pg_*`, `lo_*`, `dblink`, `COPY`, `DO`, `CALL`, `EXPLAIN ANALYZE`, `FOR UPDATE`, minúsculas, NBSP y `;` Unicode; dollar-quoting; pasan los casos de SEC-02.
- Secretos: CLI con `DATABASE_URL='postgresql://usr:MARKERPASS123@127.0.0.1:1/db'` + `SUPABASE_URL`/`KEY` marcadores, URL sin forma y URL malformada → un único mensaje genérico, 0 apariciones de marcadores; argumento desconocido no se repite; id inválido no se repite.
- `--out`: aceptado solo fuera del repo; rechazados `newout`, `../x`, symlink al repo (existente o nuevo), `/users/...` minúsculas, `/USERS/...`, mixtas, la raíz del repo. Rutas de paquete rechazadas: `../a`, `/etc/x`, `a\\b`, NUL, `tests//x`, `.hidden`, salto de línea.
- CSV: `=cmd|x`, `+1`, `-2`, `@SUM(1)` salen prefijados con `'`; comillas dobles y saltos de línea entre comillas.
- Redacción: tiempos de 1-3 ms con entradas patológicas de 40 KB (sin ReDoS).

## Estado

Ciclo 1 de 2 consumido. Para pasar a APPROVED en el ciclo 2: SEC-01, SEC-02 (endurecer o corregir la afirmación), SEC-03 y SEC-04 como obligatorios; SEC-05 a SEC-08 y DOC-01 recomendados (si no se aplican, dejar la razón en el informe técnico). No se hace commit ni push; no sustituye aprobaciones del usuario.

---

## Ciclo 2 de 2
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** con dos observaciones bajas no bloqueantes (N-1, N-2). Árbol sin commit; sin `.env`, base ni Storage reales; PoC y mutaciones en copia.

### Verificación de los hallazgos del ciclo 1
| ID | Resultado |
|---|---|
| SEC-01 | Cerrado. `session.mjs` envía `ROLLBACK` por `executeRaw` desde la lista cerrada (`sql-guard.mjs`, `assertControlStatement`), dentro de `finally` (también ante error de `work`), seguido de `transaction.rollback()` (solo libera, `adapter-pg` 7.10.0 `index.js:714-721`) y `dispose()` (`client.end()`). Si el ROLLBACK falla se libera igual y se propaga el error de la lectura. El doble ahora distingue `executeRaw('ROLLBACK')` de `release`. Nota: ninguna prueba lee el adaptador real; la equivalencia la verifiqué leyendo `dist/index.js`. |
| SEC-02 | Cerrado en la práctica. Barrera efectiva: `SET TRANSACTION READ ONLY` + `APPROVED_SQL` (`session.mjs`: `query()` rechaza todo `definition.sql` fuera de `approvedSqlTexts()` antes de la guardia; `runControl` es el único otro camino y solo admite 2 textos). No hay otra ejecución (`queryRaw`/`executeRaw` solo en `session.mjs`). Rechazados mis PoC del ciclo 1 (identificadores entrecomillados con/sin espacio y salto de línea, `E'..'`, `e'`, `B'`, `x'`, `U&`, `$a$`, `\\`, `query_to_xml`, `pg_*`, `lo_*`, `WITH ... INSERT/UPDATE`, NBSP/ZWSP/Unicode, llamadas tras comentario sin entrecomillar). Las consultas legítimas pasan (las suites ejecutan todas por la guardia). Ver N-1. |
| SEC-03 | Cerrado salvo N-2: PoC con umask 022 → carpetas creadas `700` (incluidas intermedias y la raíz creada) y archivos `600`; `manifest.sha256` también `600`. |
| SEC-04 | Cerrado. M10 (Storage con `remove`) y M14 (imprimir `DATABASE_URL`) ahora mueren (`storage.spec.ts` con Proxy, `cli.spec.ts` con `spawnSync`). |
| SEC-05 | Cerrado (`fileStem` colapsa `..`; mutación muere con 3 fallos). |
| SEC-06 | Cerrado como declaración (`piiResidual` en `manifest.json` y README); no se redactan los textos libres, decisión pendiente del usuario, no un defecto. |
| SEC-07 | Cerrado: prefijo `analysis-runs/<runId>/proposals/` antes de descargar (`index.mjs:156-163`) y tope `--storage-max-bytes` (5 MiB, máx. 64 MiB). Aceptable y declarado que, sin tamaño previo, el tope se aplica al Blob ya recibido (el SDK bufferiza la respuesta) pero antes de copiarlo; protege el paquete y la memoria posterior, no la transferencia. |
| SEC-08 | Cerrado: `sensitiveValuesFrom` añade usuario, contraseña (bruta y decodificada) y host de ambos DSN; trade-off conocido: valores cortos (p. ej. `ci`) pueden enmascarar subcadenas en mensajes de error (solo cosmético, no filtra). |
| DOC-01 | Cerrado: `manifest.sha256` sella `manifest.json` y la excepción está declarada en `finalizePackage` y README; prueba de que `sandbox-evidence.json` no tiene entradas vacías sin migración `trial` (`extraction.spec.ts:473`). |

### Observaciones nuevas (bajas, no bloqueantes)
- **N-1 (baja):** la guardia aún se evade con un identificador entrecomillado seguido de un comentario antes del paréntesis, porque la búsqueda de `(` solo salta espacios (`sql-guard.mjs`, `quotedNames.push({ ..., followedByParen })`). PoC: `SELECT "set_config"/**/('a','b',false)`, `SELECT "nextval"/*x*/(1)` y `SELECT "query_to_xml"--x\n(1)` devuelven `true` (los prefijos `pg_`/`lo_` sí se rechazan). No es alcanzable: la lista `APPROVED_SQL` y READ ONLY lo impiden, pero la frase del README «Cualquier otra función ... se rechaza» es entonces inexacta. Arreglo: calcular `followedByParen` sobre la estructura ya sin comentarios (o saltar comentarios en el lookahead) y añadir el caso a `sql-guard.spec.ts`; o matizar el README.
- **N-2 (baja):** si `--out` ya existe y está vacía (creada por el usuario con 0755), `mkdir(..., { recursive: true, mode })` no cambia su modo (PoC: `755`); lo que contiene sí queda 0700/0600. Arreglo: `chmod(outDir, 0o700)` tras el `mkdir` o documentarlo.
- Sin regresiones del flujo normal ni mensajes que filtren algo nuevo: CLI con marcadores en `DATABASE_URL`/`SUPABASE_*` no imprime ninguno (probado en ciclo 1 y cubierto ahora por `cli.spec.ts`).

### Evidencia
- Mutaciones sobre copia (`vitest run scripts/evidence-extractor`, 199 casos base): Storage con `remove` 5 fallos; imprimir URL 1; sin ROLLBACK explícito 6; quitar la barra invertida de la guardia 1; quitar el prefijo `E` 1; quitar la comprobación de nombres entrecomillados 5; sin modo 0600 1; sin 0700 en subcarpetas 1; sin 0700 en la raíz 1; sin prefijo de Storage 1; sin tope de tamaño 1; sello del manifiesto falso 2; sin scrub de contraseña del DSN 1; `fileStem` sin colapso 3; sin lista aprobada 1; sin `piiResidual` 1. **16 de 16 muertas.**
- Gates desde `app/`: `lint` 0, `lint:types` 0, `contracts:check` 0, `build` 0 (con `DATABASE_URL` de CI), `npm test`: **172 archivos pasan | 7 omitidos (179); 2981 pasan y 104 omitidos (3085)**; `--help` exit 0. Raíz: `sdd-check` OK; `validate-work-items` «passed (CORE, 93 WI)»; `validate-harness` OK; `validate-completions` «passed (90 completed WI)».
- Alcance: `git diff --stat` sobre `app/src`, `app/prisma`, `spec` y lockfile vacío; `app/package.json` solo añade `evidence:extract`; el resto son `app/scripts/**`, `CHANGELOG.md`, informes y registro del Harness.
- Documentos: CHANGELOG (199 casos, endurecimiento descrito) y README coinciden con el código salvo la matización de N-1; no piden credenciales por el chat.
- No sustituye aprobaciones del usuario ni autoriza commit, push o PR.
